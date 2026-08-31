import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, ExternalLink, ListFilter, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { api } from "../api";
import { Busy, ErrorBox, Header } from "../components/bits";

const Chip = ({ on, onClick, children }) => (
  <button
    onClick={onClick}
    className={`rounded-full border px-3 py-1.5 text-sm ${
      on
        ? "border-teal-500 bg-teal-950 text-teal-300"
        : "border-slate-700 text-slate-300 active:border-teal-600"
    }`}
  >
    {children}
  </button>
);

// What the fetch stage found — the checkpoint before any tokens are spent.
export default function Results({ go, searchId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refine, setRefine] = useState("");
  const [busy, setBusy] = useState(null); // 'screen' | 'refine' | 'clarify' | 'apply'
  const [clar, setClar] = useState(null); // { questions, sel: {i: option|'__other__'}, other: {i: text} }
  const [clarDone, setClarDone] = useState(false); // clarifier had nothing to ask — unlock screening

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    api.results(searchId)
      .then((r) => {
        if (!alive.current) return;
        setData(r);
        if (r.search.stage_detail?.clarify_status === "running") {
          setBusy("clarify");
          awaitQuestions();
        }
      })
      .catch((e) => alive.current && setError(e));
    return () => { alive.current = false; };
  }, [searchId]);

  // The clarifier runs server-side as a background task (thinking models take a
  // minute — far longer than a phone will hold a request). Poll until it lands.
  const awaitQuestions = async () => {
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, 900));
        if (!alive.current) return;
        const st = await api.status(searchId).catch(() => null); // transient miss — keep polling
        const d = st?.stage_detail;
        if (!d || d.clarify_status === "running") continue;
        if (d.clarify_status === "error") throw new Error(d.clarify_error || "clarifier failed");
        const qs = d.clarify_questions || [];
        if (!qs.length) setClarDone(true); // as narrow as the question allows
        else setClar({ questions: qs, sel: {}, other: {} });
        break;
      }
    } catch (e) {
      if (alive.current) setError(e);
    }
    if (alive.current) setBusy(null);
  };

  if (!data) {
    return (
      <>
        <Header onBack={() => go("topics")} />
        {error ? <div className="px-5 py-6"><ErrorBox error={error} /></div> : <Busy />}
      </>
    );
  }

  const { search, papers, summary } = data;
  const found = search.stage_detail?.found;
  const noAbstract = search.stage_detail?.no_abstract || 0;
  const capped = found != null && found > papers.length + noAbstract;
  const threshold = summary.clarify_threshold ?? 30;
  const needsClarify = summary.to_screen > threshold && !clarDone;

  const startScreening = async () => {
    if (busy) return;
    setBusy("screen");
    setError(null);
    try {
      await api.screenSearch(searchId);
      go("scanning", { searchId });
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  const refineQuery = async () => {
    if (busy || !refine.trim()) return;
    setBusy("refine");
    setError(null);
    try {
      await api.refineSearch(searchId, refine.trim());
      go("scanning", { searchId });
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  const loadQuestions = async () => {
    if (busy) return;
    setBusy("clarify");
    setError(null);
    try {
      await api.clarifyQuestions(searchId);
    } catch (e) {
      setError(e);
      setBusy(null);
      return;
    }
    awaitQuestions();
  };

  const pick = (i, value) =>
    setClar((c) => ({ ...c, sel: { ...c.sel, [i]: c.sel[i] === value ? undefined : value } }));

  const answers = clar
    ? clar.questions
        .map((q, i) => {
          const v = clar.sel[i];
          if (!v) return null; // unanswered = skipped
          const answer = v === "__other__" ? (clar.other[i] || "").trim() : v;
          return answer ? { question: q.text, answer } : null;
        })
        .filter(Boolean)
    : [];

  const applyAnswers = async () => {
    if (busy || answers.length === 0) return;
    setBusy("apply");
    setError(null);
    try {
      await api.clarifySearch(searchId, answers);
      go("scanning", { searchId });
    } catch (e) {
      setError(e);
      setBusy(null);
    }
  };

  return (
    <>
      <Header onBack={() => go("topics")} />
      <div className="flex-1 overflow-y-auto flex flex-col px-5 py-5 gap-5">
        <div>
          <p className="font-serif text-lg text-amber-50 leading-snug">“{search.raw_query}”</p>
          {search.refined_question && (
            <p className="text-sm text-teal-300/90 leading-snug mt-1.5">→ {search.refined_question}</p>
          )}
          {search.clarifications?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {search.clarifications.map((c, i) => (
                <span
                  key={i}
                  className="font-mono text-[11px] border border-teal-900 text-teal-400 rounded-full px-2 py-0.5"
                >
                  {c.answer}
                </span>
              ))}
            </div>
          )}
          <p className="font-mono text-xs text-slate-500 mt-2">
            PubMed matched <span className="text-slate-300">{found ?? "?"}</span> ·
            fetched <span className="text-slate-300">{papers.length}</span> with abstracts
            {noAbstract > 0 && ` (${noAbstract} without were skipped)`}
          </p>
          {capped && (
            <p className="font-mono text-xs text-amber-500 mt-1">
              only the newest were fetched — narrow the query to reach the rest
            </p>
          )}
        </div>

        {clar ? (
          /* ── the question sheet ── */
          <div className="rounded-xl border border-teal-900 bg-slate-900 p-4 flex flex-col gap-4">
            <div>
              <p className="font-mono text-xs uppercase tracking-wide text-teal-400">
                Quick questions — tap what fits
              </p>
              <p className="font-mono text-[11px] text-slate-500 mt-1">
                leave anything blank to skip it
              </p>
            </div>
            {clar.questions.map((q, i) => (
              <div key={i}>
                <p className="text-sm text-slate-200 leading-snug">{q.text}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {q.options.map((o) => (
                    <Chip key={o} on={clar.sel[i] === o} onClick={() => pick(i, o)}>
                      {o}
                    </Chip>
                  ))}
                  <Chip on={clar.sel[i] === "__other__"} onClick={() => pick(i, "__other__")}>
                    Other…
                  </Chip>
                </div>
                {clar.sel[i] === "__other__" && (
                  <input
                    autoFocus
                    value={clar.other[i] || ""}
                    onChange={(e) =>
                      setClar((c) => ({ ...c, other: { ...c.other, [i]: e.target.value } }))
                    }
                    placeholder="your answer…"
                    className="mt-2 w-full rounded-lg bg-slate-950 border border-slate-700 focus:border-teal-500 focus:outline-none px-3 py-2 text-sm text-slate-100 placeholder-slate-600"
                  />
                )}
              </div>
            ))}
            <button
              disabled={!!busy || answers.length === 0}
              onClick={applyAnswers}
              className="w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-3.5 disabled:opacity-30 active:bg-teal-400"
            >
              {busy === "apply" ? "Rebuilding query…" : "Apply & re-fetch — free"}
            </button>
            <button
              disabled={!!busy}
              onClick={() => setClar(null)}
              className="font-mono text-xs text-slate-500 active:text-slate-300 -mt-1"
            >
              never mind
            </button>
          </div>
        ) : needsClarify ? (
          /* ── the nudge: a big fetch, narrow before spending tokens ── */
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col gap-3">
            <p className="text-sm text-slate-300">
              <span className="font-semibold text-amber-400">{summary.to_screen}</span> new abstracts
              is a lot to screen — answer a couple of quick questions to narrow it first.
            </p>
            <button
              disabled={!!busy}
              onClick={loadQuestions}
              className="w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-3.5 disabled:opacity-30 active:bg-teal-400 inline-flex items-center justify-center gap-2"
            >
              {busy === "clarify" ? "Thinking…" : <><ListFilter size={17} /> Narrow it down</>}
            </button>
            <button
              disabled={!!busy}
              onClick={startScreening}
              className="font-mono text-xs text-slate-500 underline underline-offset-2 active:text-slate-300"
            >
              {busy === "screen" ? "starting…" : `screen all ${summary.to_screen} anyway`}
            </button>
          </div>
        ) : (
          /* ── the normal gate ── */
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col gap-3">
            {clarDone && (
              <p className="font-mono text-[11px] text-slate-500">
                the AI had no narrowing questions — the volume is inherent to the topic
              </p>
            )}
            <p className="text-sm text-slate-300">
              <span className="font-semibold text-teal-300">{summary.to_screen}</span> new abstract{summary.to_screen === 1 ? "" : "s"} would
              be screened by the triage model
              {summary.already_triaged > 0 && (
                <span className="text-slate-500"> · {summary.already_triaged} screened earlier, reused free</span>
              )}
            </p>
            <button
              disabled={!!busy || papers.length === 0}
              onClick={startScreening}
              className="w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-3.5 disabled:opacity-30 active:bg-teal-400 inline-flex items-center justify-center gap-2"
            >
              {busy === "screen" ? (
                "Starting…"
              ) : summary.to_screen > 0 ? (
                <><Sparkles size={17} /> Screen {summary.to_screen} abstract{summary.to_screen === 1 ? "" : "s"}</>
              ) : (
                <>Build deck — nothing new to screen <ChevronRight size={17} /></>
              )}
            </button>
            {summary.to_screen > 0 && (
              <p className="font-mono text-[11px] text-slate-500 text-center -mt-1">
                this is the step that costs tokens — refine below first if the list looks off
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="font-mono text-xs uppercase tracking-wide text-slate-500">
            Not quite right? Refine before screening
          </label>
          <textarea
            value={refine}
            onChange={(e) => setRefine(e.target.value)}
            rows={2}
            placeholder="e.g. only children under 12, RCTs only, exclude case reports…"
            className="w-full rounded-xl bg-slate-900 border border-slate-700 focus:border-teal-500 focus:outline-none p-3 text-sm text-slate-100 placeholder-slate-600 resize-none"
          />
          <div className="flex gap-2">
            <button
              disabled={!!busy || !refine.trim()}
              onClick={refineQuery}
              className="flex-1 rounded-xl border border-teal-600 text-teal-300 font-medium py-3 disabled:opacity-30 active:bg-teal-950"
            >
              {busy === "refine" ? "Refining…" : "Refine with AI"}
            </button>
            <button
              disabled={!!busy}
              onClick={() => go("filters", { searchId })}
              className="rounded-xl border border-slate-700 text-slate-300 py-3 px-4 disabled:opacity-30 active:bg-slate-900 inline-flex items-center gap-2"
            >
              <SlidersHorizontal size={15} /> Edit query
            </button>
          </div>
          <p className="font-mono text-[11px] text-slate-600">
            refining re-runs the PubMed fetch — free, repeat as often as you like
          </p>
        </div>

        {error && <ErrorBox error={error} />}

        <div>
          <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">
            Fetched records
          </p>
          <div className="flex flex-col gap-2">
            {papers.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">
                Nothing matched with an abstract — try widening the query.
              </p>
            )}
            {papers.map((p) => (
              <div key={p.paper_id} className="rounded-xl border border-slate-800 bg-slate-900 p-3.5">
                <p className="text-sm text-slate-200 leading-snug">{p.title}</p>
                <div className="flex items-center gap-2 mt-1.5 font-mono text-[11px] text-slate-500">
                  <span>{p.year || "—"}</span>
                  <span className="truncate">{p.journal || ""}</span>
                  <span className="ml-auto shrink-0 inline-flex items-center gap-1">
                    {p.triaged ? (
                      p.relevant ? (
                        <span className="text-emerald-500 inline-flex items-center gap-1">
                          <Check size={11} /> screened · {p.score}
                        </span>
                      ) : (
                        <span className="text-slate-600 inline-flex items-center gap-1">
                          <X size={11} /> screened · off-topic
                        </span>
                      )
                    ) : (
                      <span className="text-teal-500">new</span>
                    )}
                    {p.url && (
                      <a href={p.url} target="_blank" rel="noreferrer" className="text-slate-600 active:text-teal-400 p-1 -m-1 ml-0.5">
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
