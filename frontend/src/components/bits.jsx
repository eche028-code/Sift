import { AlertTriangle, ArrowLeft, Check, Eye, FileText, Layers, X } from "lucide-react";
import { gradeOf } from "../grade";

export const Wordmark = ({ size = "text-2xl" }) => (
  <span className={`font-serif italic ${size} text-amber-50 inline-flex items-center gap-2`}>
    <Eye size={size === "text-2xl" ? 20 : 16} className="text-teal-400" />
    sift
  </span>
);

export const Header = ({ onBack, right }) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
    <button onClick={onBack} className="p-2 -ml-2 text-slate-400 active:text-slate-200" aria-label="Back">
      <ArrowLeft size={20} />
    </button>
    <Wordmark size="text-lg" />
    <div className="w-16 flex justify-end">{right}</div>
  </div>
);

export const PoolChip = ({ count, onClick }) => (
  <button
    onClick={onClick}
    className="inline-flex items-center gap-1.5 rounded-full border border-teal-500 text-teal-300 font-mono text-xs px-2.5 py-1 active:bg-teal-950"
  >
    <Layers size={13} /> {count}
  </button>
);

export const DesignChip = ({ children }) => (
  <span className="font-mono text-xs uppercase tracking-wide border border-stone-400 text-stone-700 rounded px-1.5 py-0.5">
    {children}
  </span>
);

export const BadgeDot = ({ ok, children }) => (
  <span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-stone-700" : "text-stone-400 line-through"}`}>
    {ok ? <Check size={12} className="text-emerald-600" /> : <X size={12} />}
    {children}
  </span>
);

export const Meter = ({ score }) => {
  const g = gradeOf(score);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-mono text-xs uppercase tracking-wide text-stone-500">Evidence</span>
        <span className={`font-mono text-xs ${g.text}`}>{g.label} · {score}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-stone-200 overflow-hidden">
        <div className={`h-full rounded-full ${g.bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
};

// The paper card — cream stock on the dark reading-room ground.
export const PaperCard = ({ p, stampKeep = 0, stampSkip = 0 }) => (
  <div className="relative h-full w-full rounded-2xl bg-amber-50 text-stone-900 shadow-2xl border border-amber-100 flex flex-col overflow-hidden select-none">
    <div
      className="absolute top-6 left-5 border-4 border-emerald-600 text-emerald-700 font-mono font-bold tracking-widest text-xl px-3 py-1 rounded rotate-12 z-10"
      style={{ opacity: stampKeep }}
    >
      ADD TO POOL
    </div>
    <div
      className="absolute top-6 right-5 border-4 border-rose-600 text-rose-700 font-mono font-bold tracking-widest text-xl px-3 py-1 rounded -rotate-12 z-10"
      style={{ opacity: stampSkip }}
    >
      SKIP
    </div>

    <div className="p-5 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2 flex-wrap">
        <DesignChip>{p.design || "Study"}</DesignChip>
        <span className="font-mono text-xs text-stone-500">{p.year || "—"}</span>
        <span className="font-mono text-xs text-stone-500 truncate max-w-36">{p.journal}</span>
        {p.pdf_url && (
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-xs text-teal-700 border border-teal-600 rounded px-1.5 py-0.5">
            <FileText size={12} /> PDF
          </span>
        )}
      </div>

      <h2 className="font-serif text-xl leading-snug line-clamp-4">{p.title}</h2>

      {p.finding && (
        <p className="text-sm font-medium border-l-2 border-teal-600 pl-3 text-stone-800 line-clamp-3">
          {p.finding}
        </p>
      )}

      <p className="font-mono text-xs text-stone-500">
        n={p.n ?? "—"} · {p.followup || "—"} · {p.authors || "authors unlisted"}
      </p>

      <div className="mt-auto flex flex-col gap-3">
        <Meter score={p.score} />
        <div className="flex gap-3 flex-wrap">
          <BadgeDot ok={p.peer_reviewed}>Peer-reviewed</BadgeDot>
          <BadgeDot ok={p.randomised}>Randomised</BadgeDot>
          <BadgeDot ok={p.masked}>Masked</BadgeDot>
        </div>
        {p.weakness && (
          <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-100 rounded-lg px-3 py-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span className="line-clamp-3">{p.weakness}</span>
          </p>
        )}
      </div>
    </div>
  </div>
);

export const Busy = ({ children }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-3">
    <span className="w-5 h-5 rounded-full border-2 border-teal-400 border-t-transparent animate-spin" />
    {children && <p className="font-mono text-sm text-slate-400">{children}</p>}
  </div>
);

export const ErrorBox = ({ error, action }) => (
  <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">
    <p className="flex items-start gap-2">
      <AlertTriangle size={15} className="shrink-0 mt-0.5" />
      <span>{String(error?.message || error)}</span>
    </p>
    {action}
  </div>
);

// ── tiny markdown renderer for synthesis notes ───────────────
const inline = (text, keyBase) => {
  const parts = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(
        <span key={`${keyBase}-${i++}`} className="font-medium">
          {tok.slice(2, -2)}
        </span>
      );
    } else {
      parts.push(
        <span key={`${keyBase}-${i++}`} className="font-mono text-xs text-stone-500">
          {tok.slice(1, -1)}
        </span>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
};

export const Markdown = ({ text }) => {
  const out = [];
  (text || "").split(/\r?\n/).forEach((line, idx) => {
    const t = line.trim();
    if (!t) return;
    if (t.startsWith("## ")) {
      out.push(
        <p key={idx} className="font-mono text-xs uppercase tracking-wide text-stone-500 mt-5 mb-2">
          {t.slice(3)}
        </p>
      );
    } else if (t.startsWith("# ")) {
      out.push(
        <h3 key={idx} className="font-serif text-lg leading-snug mt-4 mb-2">
          {t.slice(2)}
        </h3>
      );
    } else if (/^[-*•] /.test(t)) {
      out.push(
        <div key={idx} className="mb-3 pl-3 border-l-2 border-teal-600 text-sm text-stone-800 leading-relaxed">
          {inline(t.replace(/^[-*•] /, ""), idx)}
        </div>
      );
    } else {
      out.push(
        <p key={idx} className="text-sm text-stone-700 mb-2 leading-relaxed">
          {inline(t, idx)}
        </p>
      );
    }
  });
  return <div>{out}</div>;
};
