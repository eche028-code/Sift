import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { api } from "../api";
import { Header } from "../components/bits";

export default function Scanning({ go, searchId }) {
  const [st, setSt] = useState(null);
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const r = await api.status(searchId);
        if (!alive) return;
        setSt(r);
        if (r.stage === "ready") {
          timer = setTimeout(() => alive && goRef.current("deck", { searchId }), 500);
          return;
        }
        if (r.stage === "error") return; // stop polling, show the error
      } catch { /* transient — keep polling */ }
      timer = setTimeout(tick, 700);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [searchId]);

  const stage = st?.stage;
  const d = st?.stage_detail || {};

  const searchDone = stage === "screening" || stage === "ready";
  const screenLabel =
    d.to_screen === 0 && searchDone
      ? "No new abstracts — reusing earlier screenings"
      : `Screening ${d.to_screen ?? "…"} abstracts with triage model` +
        (stage === "screening" && d.to_screen ? ` (${d.screened ?? 0}/${d.to_screen})` : "");

  const lines = [
    { label: "Translating natural language → PubMed syntax", state: "done" },
    {
      label:
        "Querying PubMed · Crossref · Unpaywall" +
        (d.found != null ? ` — ${d.found} records` : ""),
      state: stage === "searching" ? "active" : searchDone ? "done" : "todo",
    },
    {
      label: screenLabel,
      state: stage === "screening" ? "active" : stage === "ready" ? "done" : "todo",
    },
    {
      label: d.passed != null ? `${d.passed} papers pass triage` : "Ranking the deck",
      state: stage === "ready" ? "done" : "todo",
    },
  ];

  if (stage === "error") {
    return (
      <>
        <Header onBack={() => go("topics")} />
        <div className="flex-1 flex flex-col justify-center px-8 gap-4">
          <p className="font-mono text-sm text-rose-400 flex items-start gap-3">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            {d.error || "The pipeline failed."}
          </p>
          <button
            onClick={() => go("filters", { searchId })}
            className="mt-4 w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-3.5 active:bg-teal-400"
          >
            Edit query and retry
          </button>
          <button
            onClick={() => go("topics")}
            className="w-full rounded-xl border border-slate-700 text-slate-300 py-3.5"
          >
            Back to topics
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-center px-8 gap-4">
      {lines.map((l) => (
        <p
          key={l.label}
          className={`font-mono text-sm flex items-center gap-3 ${
            l.state === "done" ? "text-slate-300" : l.state === "active" ? "text-teal-300" : "text-slate-700"
          }`}
        >
          {l.state === "done" ? (
            <Check size={14} className="text-emerald-500 shrink-0" />
          ) : (
            <span
              className={`w-3.5 h-3.5 rounded-full border shrink-0 ${
                l.state === "active" ? "border-teal-400 animate-pulse" : "border-slate-700"
              }`}
            />
          )}
          {l.label}
        </p>
      ))}
    </div>
  );
}
