import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "../api";
import { Busy, ErrorBox, Header } from "../components/bits";
import { gradeOf } from "../grade";

export default function Pool({ go, searchId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.pool(searchId)
      .then((r) => alive && setData(r))
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [searchId]);

  const kept = data?.papers || [];

  return (
    <>
      <Header
        onBack={() => go("deck", { searchId })}
        right={<span className="font-mono text-xs text-slate-500">{kept.length} kept</span>}
      />
      {error && <div className="px-5 py-4"><ErrorBox error={error} /></div>}
      {!data && !error ? (
        <Busy />
      ) : (
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {kept.length === 0 && (
            <p className="text-sm text-slate-500 text-center mt-16">
              Nothing in the pool yet — swipe right on a card to keep it.
            </p>
          )}
          {kept.map((p) => (
            <button
              key={p.paper_id}
              onClick={() => go("detail", { searchId, paper: p })}
              className="text-left rounded-xl border border-slate-800 bg-slate-900 p-4 active:border-teal-600"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-mono text-xs uppercase text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
                  {p.design || "Study"}
                </span>
                <span className="font-mono text-xs text-slate-600">{p.year}</span>
                <span className={`ml-auto font-mono text-xs ${gradeOf(p.score).text}`}>{p.score}</span>
              </div>
              <p className="font-serif text-amber-50 leading-snug">{p.title}</p>
            </button>
          ))}
        </div>
      )}
      {kept.length > 0 && (
        <div className="px-5 pb-8 pt-2">
          <button
            onClick={() => go("note", { searchId, generate: true, backTo: "pool" })}
            className="w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-4 inline-flex items-center justify-center gap-2 active:bg-teal-400"
          >
            <Sparkles size={18} /> Synthesise {kept.length} paper{kept.length > 1 ? "s" : ""} into a note
          </button>
        </div>
      )}
    </>
  );
}
