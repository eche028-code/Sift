import { AlertTriangle, Check, ExternalLink, FileText, Trash2 } from "lucide-react";
import { api } from "../api";
import { Header, Meter } from "../components/bits";

export default function Detail({ go, searchId, paper: p }) {
  if (!p) {
    go("pool", { searchId });
    return null;
  }

  const remove = async () => {
    await api.decide(searchId, p.paper_id, "skipped").catch(() => {});
    go("pool", { searchId });
  };

  return (
    <>
      <Header onBack={() => go("pool", { searchId })} />
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs uppercase text-slate-400 border border-slate-600 rounded px-1.5 py-0.5">
            {p.design || "Study"}
          </span>
          <span className="font-mono text-xs text-slate-500">
            {p.year} · {p.journal}
          </span>
          {p.pdf_url && (
            <span className="font-mono text-xs text-teal-400 inline-flex items-center gap-1">
              <FileText size={12} /> PDF
            </span>
          )}
        </div>
        <h2 className="font-serif text-2xl text-amber-50 leading-snug">{p.title}</h2>
        <p className="font-mono text-xs text-slate-500">
          n={p.n ?? "—"} · {p.followup || "—"} · {p.authors || "authors unlisted"}
        </p>

        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
          <Meter score={p.score} />
        </div>

        {p.finding && (
          <p className="text-sm font-medium border-l-2 border-teal-600 pl-3 text-slate-200">
            {p.finding}
          </p>
        )}

        {p.abstract ? (
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">Abstract</p>
            <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-line">{p.abstract}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No abstract on record.</p>
        )}

        {p.strengths?.length > 0 && (
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">Strengths</p>
            {p.strengths.map((s) => (
              <p key={s} className="text-sm text-slate-300 flex gap-2 mb-1.5">
                <Check size={14} className="text-emerald-500 shrink-0 mt-0.5" /> {s}
              </p>
            ))}
          </div>
        )}
        {p.weakness && (
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">
              Flagged weakness
            </p>
            <p className="text-sm text-amber-400 flex gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {p.weakness}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3 mt-2">
          {p.pdf_url && (
            <a
              href={p.pdf_url}
              target="_blank"
              rel="noreferrer"
              className="w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-3.5 inline-flex items-center justify-center gap-2 active:bg-teal-400"
            >
              <FileText size={16} /> Open PDF
            </a>
          )}
          {p.url && (
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="w-full rounded-xl border border-slate-700 text-slate-300 py-3.5 inline-flex items-center justify-center gap-2 active:bg-slate-900"
            >
              <ExternalLink size={16} /> View on PubMed
            </a>
          )}
          <button
            onClick={remove}
            className="w-full rounded-xl border border-rose-800 text-rose-400 py-3.5 inline-flex items-center justify-center gap-2 active:bg-rose-950"
          >
            <Trash2 size={16} /> Remove from pool
          </button>
        </div>
      </div>
    </>
  );
}
