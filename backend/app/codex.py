"""Codex export — one Note becomes one `fragment.json` (spec v1).

The shape is Codex's, not ours. Three rules carry most of the spec:

* constants (`kind`, `source`, `provenance`) are emitted EXPLICITLY, even where
  Codex would infer the same value — a stored value reads back `inferred: false`;
* `completeness`, `retired_at`, `superseded_by` and `slots` are NEVER emitted —
  the first three are computed/lifecycle, `slots` is case_fragment-only;
* `body` is the note markdown verbatim, and `reflection` is clinician-authored
  or absent. Nothing in this module writes prose into either.

`id` is deterministic (`sift-note-<note_id>`), which is also Codex's idempotency
key: re-importing the same note fails loudly there instead of duplicating.
"""

import json
import re
from pathlib import Path

import yaml

from .db import DATA_DIR
from .models import Note, utcnow

# Dropped here by the reader, or written by the paste box in Settings. Source is
# Codex's own `anchors.export_taxonomy_yaml` — tags are never free-invented.
TAXONOMY_PATH: Path = DATA_DIR / "codex_taxonomy.yaml"

KIND = "journal_reflection"
SOURCE = "sift"
PROVENANCE = "literature_derived"

# Structural or descriptive keys — containers to walk through, not tags to collect.
_SKIP_KEYS = {
    "aliases", "anchors", "categories", "children", "count", "description",
    "domains", "exported_at", "generated_at", "groups", "items", "label", "list",
    "name", "notes", "schema", "source", "synonyms", "tags", "taxonomy", "terms",
    "title", "updated_at", "values", "version", "vocabulary",
}


def normalise_tag(raw: str) -> str:
    """lower_snake_case — the form Codex re-normalises to anyway."""
    return re.sub(r"[^a-z0-9]+", "_", (raw or "").strip().lower()).strip("_")


def _looks_like_tag(raw: str) -> bool:
    t = normalise_tag(raw)
    return bool(t) and len(t) <= 48 and t.count("_") <= 4


def _walk(node, out: list[str]) -> None:
    """Collect tag-shaped strings from an unknown YAML shape.

    Taxonomy exports come in several shapes (flat list, key-per-term with
    descriptions, nested domains) and this has to survive all of them, so it
    takes mapping keys and list scalars alike and leans on `_SKIP_KEYS` to drop
    the scaffolding. Anything it gets wrong is visible: Settings shows the
    parsed tag count, and every tag is confirmed by hand before it ships.
    """
    if isinstance(node, dict):
        for key, value in node.items():
            name = str(key)
            if name.lower() not in _SKIP_KEYS and _looks_like_tag(name):
                out.append(name)
            if isinstance(value, (dict, list)):
                _walk(value, out)
    elif isinstance(node, list):
        for item in node:
            if isinstance(item, str):
                if _looks_like_tag(item):
                    out.append(item)
            else:
                _walk(item, out)


def load_taxonomy() -> list[str]:
    """The Codex vocabulary, or [] when no export has been dropped in yet."""
    try:
        raw = TAXONOMY_PATH.read_text(encoding="utf-8")
    except OSError:
        return []
    try:
        doc = yaml.safe_load(raw)
    except yaml.YAMLError:
        return []
    found: list[str] = []
    _walk(doc, found)
    return sorted({normalise_tag(t) for t in found} - {""})


def save_taxonomy(text: str) -> list[str]:
    """Store a pasted taxonomy export. Raises ValueError if it will not parse."""
    try:
        yaml.safe_load(text)
    except yaml.YAMLError as e:
        raise ValueError(f"not valid YAML: {e}") from e
    TAXONOMY_PATH.write_text(text, encoding="utf-8")
    return load_taxonomy()


def suggest_tags(text: str, taxonomy: list[str] | None = None) -> list[str]:
    """Taxonomy terms whose words appear in the note — plain matching, no model call.

    Suggestion stays free and instant on purpose: the clinician confirms every
    tag in the dialog anyway, so a token spend here would buy nothing.
    """
    tags = load_taxonomy() if taxonomy is None else taxonomy
    hay = " " + re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip() + " "

    def present(tag: str) -> bool:
        phrase = tag.replace("_", " ")
        # a note says "dry eyes" where the vocabulary says dry_eye, so accept a
        # plural on the last word too — cheap recall, and every hit is confirmed
        return f" {phrase} " in hay or f" {phrase}s " in hay

    hits = [(t.count("_"), t) for t in tags if present(t)]
    hits.sort(key=lambda h: (-h[0], h[1]))  # most specific term first
    return [t for _, t in hits]


def tag_list(raw: str | None) -> list[str]:
    """Parse the stored JSON column into normalised, deduped, ordered tags."""
    try:
        parsed = json.loads(raw) if raw else []
    except ValueError:
        return []
    if not isinstance(parsed, list):
        return []
    out: list[str] = []
    for item in parsed:
        t = normalise_tag(str(item))
        if t and t not in out:
            out.append(t)
    return out


_Q_HEADING = re.compile(r"^\s*#\s*Q\s*:", re.IGNORECASE)


def _with_question_heading(body: str, question: str | None) -> str:
    """Guarantee the `# Q:` opening line the spec requires.

    Notes written since this export exists already open that way (the synthesis
    prompt says so). Older notes, and notes made under custom synthesis
    instructions, get the line prepended here — the only edit ever made to the
    markdown, and the reason `body` can still be called verbatim.
    """
    text = (body or "").strip()
    if _Q_HEADING.match(text.split("\n", 1)[0]):
        return text
    q = (question or "").strip()
    return f"# Q: {q}\n\n{text}" if q else text


def _iso_tz(ts: str | None) -> str:
    """ISO-8601 with an offset. Rows are written that way; be safe about imports."""
    s = (ts or "").strip()
    if not s:
        return utcnow()
    if re.search(r"(Z|[+-]\d{2}:?\d{2})$", s):
        return s.replace("Z", "+00:00")
    return f"{s}+00:00"


def filename(note_id: int) -> str:
    return f"sift-note-{note_id}.fragment.json"


def fragment(note: Note, question: str | None) -> dict:
    """The v1 fragment for one note. Field order matches the spec's example."""
    frag = {
        "id": f"sift-note-{note.id}",
        "created_at": _iso_tz(note.created_at),  # the snapshot's date, not export time
        "kind": KIND,
        "source": SOURCE,
        "provenance": PROVENANCE,
        "tags": tag_list(note.tags),
        "body": _with_question_heading(note.body_md, question),
    }
    reflection = (note.reflection or "").strip()
    if reflection:  # absent when blank — never a machine-written stand-in
        frag["reflection"] = reflection
    return frag
