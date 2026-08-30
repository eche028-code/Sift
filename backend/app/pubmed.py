"""PubMed E-utilities: esearch (history) + efetch (XML) → paper dicts."""

import asyncio
import logging
import re
import xml.etree.ElementTree as ET

import httpx

from . import settings_store as st

log = logging.getLogger("sift.pubmed")

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _common_params() -> dict:
    p = {"tool": "sift", "db": "pubmed"}
    if email := st.get("contact_email"):
        p["email"] = email
    return p


async def _get(client: httpx.AsyncClient, url: str, params: dict) -> httpx.Response:
    delay = 0.35  # keyless E-utilities allows ~3 req/s
    for attempt in range(3):
        await asyncio.sleep(delay)
        try:
            r = await client.get(url, params=params)
            if r.status_code == 429 or r.status_code >= 500:
                raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
            r.raise_for_status()
            return r
        except Exception:
            if attempt == 2:
                raise
            await asyncio.sleep(1.5 * (attempt + 1))
    raise RuntimeError("unreachable")


async def esearch(
    client: httpx.AsyncClient,
    term: str,
    date_from: str | None,
    date_to: str | None,
) -> tuple[int, str, str]:
    """Returns (count, webenv, query_key). Dates are ISO YYYY-MM-DD."""
    params = _common_params() | {
        "term": term,
        "retmode": "json",
        "retmax": "0",
        "usehistory": "y",
    }
    if date_from or date_to:
        params["datetype"] = "pdat"
        if date_from:
            params["mindate"] = date_from.replace("-", "/")
        params["maxdate"] = (date_to or "3000").replace("-", "/")
    r = await _get(client, f"{EUTILS}/esearch.fcgi", params)
    res = r.json()["esearchresult"]
    if "ERROR" in res:
        raise ValueError(f"PubMed rejected the query: {res['ERROR']}")
    return int(res["count"]), res.get("webenv", ""), res.get("querykey", "")


async def efetch_page(
    client: httpx.AsyncClient, webenv: str, query_key: str, retstart: int, retmax: int
) -> list[dict]:
    params = _common_params() | {
        "WebEnv": webenv,
        "query_key": query_key,
        "retstart": str(retstart),
        "retmax": str(retmax),
        "retmode": "xml",
    }
    r = await _get(client, f"{EUTILS}/efetch.fcgi", params)
    return parse_pubmed_xml(r.text)


def _text(el: ET.Element | None) -> str | None:
    if el is None:
        return None
    s = "".join(el.itertext()).strip()
    return s or None


def _parse_article(art: ET.Element) -> dict | None:
    cit = art.find("MedlineCitation")
    if cit is None:
        return None
    article = cit.find("Article")
    if article is None:
        return None

    pmid = _text(cit.find("PMID"))
    title = _text(article.find("ArticleTitle"))
    if not title:
        return None

    # abstract — join labelled sections
    abstract = None
    abs_el = article.find("Abstract")
    if abs_el is not None:
        chunks = []
        for t in abs_el.findall("AbstractText"):
            txt = _text(t)
            if not txt:
                continue
            label = t.get("Label")
            chunks.append(f"{label.capitalize()}: {txt}" if label and label.upper() != "UNLABELLED" else txt)
        abstract = "\n".join(chunks) or None

    # authors — first three, then et al.
    names = []
    for a in article.findall("AuthorList/Author"):
        coll = _text(a.find("CollectiveName"))
        if coll:
            names.append(coll)
            continue
        last = _text(a.find("LastName"))
        init = _text(a.find("Initials"))
        if last:
            names.append(f"{last} {init}" if init else last)
    if len(names) > 3:
        authors = ", ".join(names[:3]) + ", et al."
    else:
        authors = ", ".join(names) or None

    journal_el = article.find("Journal")
    journal = None
    if journal_el is not None:
        journal = _text(journal_el.find("ISOAbbreviation")) or _text(journal_el.find("Title"))

    # date: prefer ArticleDate, fall back to JournalIssue/PubDate
    year, month, day = None, 1, 1
    ad = article.find("ArticleDate")
    pd = article.find("Journal/JournalIssue/PubDate")
    for el in (ad, pd):
        if el is None or year is not None:
            continue
        y = _text(el.find("Year"))
        if y and y.isdigit():
            year = int(y)
            m = (_text(el.find("Month")) or "").lower()[:3]
            if m.isdigit():
                month = int(m)
            elif m in MONTHS:
                month = MONTHS[m]
            d = _text(el.find("Day")) or ""
            if d.isdigit():
                day = int(d)
    if year is None and pd is not None:
        md = _text(pd.find("MedlineDate")) or ""
        if m := re.search(r"\b(19|20)\d{2}\b", md):
            year = int(m.group(0))
    pub_date = f"{year:04d}-{month:02d}-{min(day, 28):02d}" if year else None

    doi = None
    pmcid = None
    for el in article.findall("ELocationID"):
        if el.get("EIdType") == "doi":
            doi = _text(el)
    for el in art.findall("PubmedData/ArticleIdList/ArticleId"):
        if el.get("IdType") == "doi" and not doi:
            doi = _text(el)
        if el.get("IdType") == "pmc":
            pmcid = _text(el)

    return {
        "pmid": pmid,
        "doi": normalise_doi(doi),
        "pmcid": pmcid,
        "title": title,
        "authors": authors,
        "journal": journal,
        "year": year,
        "pub_date": pub_date,
        "abstract": abstract,
        "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None,
    }


def parse_pubmed_xml(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    out = []
    for art in root.findall("PubmedArticle"):
        try:
            rec = _parse_article(art)
            if rec:
                out.append(rec)
        except Exception:
            log.exception("failed to parse a PubMed record")
    return out


def normalise_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    doi = doi.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "https://dx.doi.org/", "http://dx.doi.org/", "doi:"):
        if doi.startswith(prefix):
            doi = doi[len(prefix):]
    return doi.strip() or None
