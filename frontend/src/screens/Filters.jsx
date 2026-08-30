import { useEffect, useState } from "react";
import { Bookmark, FileText } from "lucide-react";
import { api } from "../api";
import { Busy, ErrorBox, Header } from "../components/bits";

const RANGES = [
  { id: "1y", label: "1 yr", years: 1 },
  { id: "5y", label: "5 yrs", years: 5 },
  { id: "10y", label: "10 yrs", years: 10 },
  { id: "all", label: "All", years: null },
];

const isoYearsAgo = (years) => {
  if (!years) return null;
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};

const Toggle = ({ on, onClick, icon, children }) => (
  <button
    onClick={onClick}
    className="flex items-center justify-between rounded-xl border border-slate-700 px-4 py-3.5"
  >
    <span className="text-sm text-slate-300 inline-flex items-center gap-2">
      {icon} {children}
    </span>
    <span className={`w-11 h-6 rounded-full p-0.5 transition-colors ${on ? "bg-teal-500" : "bg-slate-700"}`}>
      <span className={`block w-5 h-5 rounded-full bg-slate-950 transition-transform ${on ? "translate-x-5" : ""}`} />
    </span>
  </button>
);

export default function Filters({ go, search: initial, searchId }) {
  const [search, setSearch] = useState(initial || null);
  const [translated, setTranslated] = useState(initial?.translated_query || "");
  const [range, setRange] = useState("5y");
  const [pdfOnly, setPdfOnly] = useState(initial ? !!initial.pdf_only : false);
  const [watch, setWatch] = useState(initial ? !!initial.is_saved : false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (search || !searchId) return;
    api.getSearch(searchId).then((sr) => {
      setSearch(sr);
      setTranslated(sr.translated_query || "");
      setPdfOnly(!!sr.pdf_only);
      setWatch(!!sr.is_saved);
    }).catch(setError);
  }, [searchId]);

  if (!search) {
    return (
      <>
        <Header onBack={() => go("topics")} />
        {error ? <div className="px-5 py-6"><ErrorBox error={error} /></div> : <Busy />}
      </>
    );
  }

  const rationale = search.stage_detail?.rationale;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.patchSearch(search.id, {
        translated_query: translated.trim(),
        date_from: isoYearsAgo(RANGES.find((r) => r.id === range).years),
        date_to: null,
        pdf_only: pdfOnly,
        is_saved: watch,
      });
      await api.runSearch(search.id);
      go("scanning", { searchId: search.id });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <>
      <Header onBack={() => go("search")} />
      <div className="flex-1 overflow-y-auto flex flex-col px-5 py-6 gap-6">
        <div>
          <p className="font-serif text-lg text-amber-50 leading-snug">“{search.raw_query}”</p>
          <p className="font-mono text-xs text-slate-500 mt-3">
            <span className="text-teal-400">interpreted — edit if needed</span>
          </p>
          <textarea
            value={translated}
            onChange={(e) => setTranslated(e.target.value)}
            rows={5}
            spellCheck={false}
            className="mt-2 w-full rounded-xl bg-slate-900 border border-slate-700 focus:border-teal-500 focus:outline-none p-3 font-mono text-xs leading-relaxed text-slate-300 resize-none"
          />
          {rationale && <p className="text-xs text-slate-500 mt-1.5">{rationale}</p>}
        </div>

        <div>
          <label className="font-mono text-xs uppercase tracking-wide text-slate-500">
            Published within
          </label>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-lg py-2.5 text-sm border ${
                  range === r.id
                    ? "border-teal-500 bg-teal-950 text-teal-300"
                    : "border-slate-700 text-slate-400"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <Toggle on={pdfOnly} onClick={() => setPdfOnly((v) => !v)}
          icon={<FileText size={16} className="text-slate-500" />}>
          Full text (PDF) only
        </Toggle>

        <Toggle on={watch} onClick={() => setWatch((v) => !v)}
          icon={<Bookmark size={16} className="text-slate-500" />}>
          Watch this topic — monthly updates
        </Toggle>

        <p className="font-mono text-xs text-slate-500">
          First run fetches up to 200 records, newest first. Watched topics keep crawling
          forward monthly and backfill older years.
        </p>

        {error && <ErrorBox error={error} />}

        <button
          disabled={busy || !translated.trim()}
          onClick={run}
          className="mt-auto w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-4 disabled:opacity-30 active:bg-teal-400"
        >
          {busy ? "Starting…" : "Run search"}
        </button>
      </div>
    </>
  );
}
