import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, ExternalLink, Eye, FileText, HelpCircle, History,
  Layers, Maximize2, Menu, Search, Settings, X,
} from "lucide-react";
import { gradeOf } from "../grade";

export const Wordmark = ({ size = "text-2xl" }) => (
  <span className={`font-serif italic ${size} text-amber-50 inline-flex items-center gap-2`}>
    <Eye size={size === "text-2xl" ? 20 : 16} className="text-teal-400" />
    sift
  </span>
);

export const Header = ({ onBack, menu, right }) => (
  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
    {menu ?? (
      <button onClick={onBack} className="p-2 -ml-2 text-slate-400 active:text-slate-200" aria-label="Back">
        <ArrowLeft size={20} />
      </button>
    )}
    <Wordmark size="text-lg" />
    <div className="w-16 flex justify-end">{right}</div>
  </div>
);

export const GearButton = ({ onClick, className = "" }) => (
  <button
    onClick={onClick}
    className={`p-2 -mr-2 text-slate-400 active:text-teal-300 ${className}`}
    aria-label="Settings"
  >
    <Settings size={20} />
  </button>
);

// The triple-bar drawer: the app's top-level pages, opposite the settings gear.
const NAV_ITEMS = [
  { id: "search", label: "New Search", Icon: Search },
  { id: "topics", label: "Recent Search", Icon: History },
  { id: "notes", label: "Library", Icon: FileText },
  { id: "help", label: "How to use", Icon: HelpCircle },
];

export const NavMenu = ({ go, current, className = "" }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`p-2 -ml-2 text-slate-400 active:text-teal-300 ${className}`}
        aria-label="Menu"
      >
        <Menu size={20} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-center" onClick={() => setOpen(false)}>
          {/* stay inside the phone column on wide screens, like the deck's expanded view */}
          <div className="w-full max-w-md h-full relative">
            <div className="absolute inset-0 bg-slate-950/70" />
            <nav
              className="absolute left-0 top-0 h-full w-64 bg-slate-900 border-r border-slate-800 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-8 pb-6">
                <Wordmark />
              </div>
              {NAV_ITEMS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => {
                    setOpen(false);
                    if (id !== current) go(id);
                  }}
                  className={`flex items-center gap-3 px-5 py-3.5 text-left text-sm border-l-2 ${
                    id === current
                      ? "border-teal-500 bg-teal-950/40 text-teal-300"
                      : "border-transparent text-slate-300 active:bg-slate-800"
                  }`}
                >
                  <Icon size={16} className={id === current ? "text-teal-400" : "text-slate-500"} />
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
};

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

// Findings run long (median ~260 chars), so the summary block takes every pixel
// the fixed rows leave behind and fades out rather than clamping to a line count.
const FADE = "linear-gradient(to bottom, #000 80%, transparent 100%)";

// The paper card — cream stock on the dark reading-room ground.
// tapHint (top card only): advertise that a tap opens the full, unclipped view.
export const PaperCard = ({ p, stampKeep = 0, stampSkip = 0, tapHint = false }) => {
  const titleRef = useRef(null);
  const bodyRef = useRef(null);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const overflows = (el) => !!el && el.scrollHeight > el.clientHeight + 1;
    // The body is flex-sized, so measure after layout settles and on every resize.
    const check = () => setClipped(overflows(titleRef.current) || overflows(bodyRef.current));
    const raf = requestAnimationFrame(check);
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", check);
    };
  }, [p]);

  return (
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

      <div className="p-4 flex flex-col gap-2.5 h-full min-h-0">
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

        <h2 ref={titleRef} className="font-serif text-lg leading-snug line-clamp-4">{p.title}</h2>

        <div
          ref={bodyRef}
          className="flex-1 min-h-0 overflow-hidden"
          style={clipped ? { maskImage: FADE, WebkitMaskImage: FADE } : undefined}
        >
          {p.finding && (
            <p className="text-sm font-medium border-l-2 border-teal-600 pl-3 text-stone-800 leading-relaxed">
              {p.finding}
            </p>
          )}
          {p.abstract && (
            <p className="mt-2.5 pl-3 text-xs leading-relaxed text-stone-500 whitespace-pre-line">
              {p.abstract}
            </p>
          )}
        </div>

        <p className="font-mono text-xs text-stone-500 truncate">
          n={p.n ?? "—"} · {p.followup || "—"} · {p.authors || "authors unlisted"}
        </p>

        <div className="flex flex-col gap-2.5">
          <Meter score={p.score} />
          <div className="flex gap-3 flex-wrap">
            <BadgeDot ok={p.peer_reviewed}>Peer-reviewed</BadgeDot>
            <BadgeDot ok={p.randomised}>Randomised</BadgeDot>
            <BadgeDot ok={p.masked}>Masked</BadgeDot>
          </div>
          {p.weakness && (
            <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-100 rounded-lg px-2.5 py-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span className="line-clamp-2">{p.weakness}</span>
            </p>
          )}
          {tapHint && (
            <p className="flex items-center justify-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-stone-400 -mb-0.5">
              <Maximize2 size={11} />
              {clipped ? "tap to read it all" : "tap for details"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

// Full, unclipped paper view — shared by the pool Detail screen and the
// in-deck expanded card. Everything the triage produced, plus the abstract.
export const PaperFull = ({ p }) => (
  <div className="flex flex-col gap-5">
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

    {(p.pdf_url || p.url) && (
      <div className="flex flex-col gap-3">
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
      </div>
    )}
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
