import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { api } from "../api";
import { ErrorBox, GearButton, Header, NavMenu } from "../components/bits";

const SAMPLES = [
  "Does IPL beat warm compresses for meibomian gland dysfunction?",
  "Is red-light therapy safe for myopia control?",
];

export default function Search({ go, prefill }) {
  const [query, setQuery] = useState(prefill || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const search = await api.createSearch(query.trim());
      go("scanning", { searchId: search.id });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <>
      <Header
        menu={<NavMenu go={go} current="search" />}
        right={<GearButton onClick={() => go("settings")} />}
      />
      <div className="flex-1 flex flex-col px-5 pt-6 pb-8 gap-6">
        <div>
          <label className="font-mono text-xs uppercase tracking-wide text-slate-500">
            Ask in plain language
          </label>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
            placeholder="e.g. Does ortho-k slow axial elongation in kids under 12?"
            className="mt-2 w-full rounded-xl bg-slate-900 border border-slate-700 focus:border-teal-500 focus:outline-none p-4 text-base text-slate-100 placeholder-slate-600 resize-none"
          />
        </div>

        <div>
          <p className="font-mono text-xs uppercase tracking-wide text-slate-500">
            Example:
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {SAMPLES.map((s) => (
              <button
                key={s}
                onClick={() => setQuery(s)}
                className="text-left text-sm text-slate-400 border border-slate-800 rounded-lg px-3 py-2 active:border-teal-600 active:text-teal-300"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <ErrorBox
            error={error}
            action={
              error.status === 409 ? (
                <button
                  onClick={() => go("settings")}
                  className="mt-2 font-mono text-xs text-teal-300 underline underline-offset-2"
                >
                  Open Settings
                </button>
              ) : null
            }
          />
        )}

        <button
          disabled={!query.trim() || busy}
          onClick={submit}
          className="mt-auto w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-4 disabled:opacity-30 active:bg-teal-400 inline-flex items-center justify-center gap-2"
        >
          {busy ? "Converting…" : <>Screen the literature <ChevronRight size={18} /></>}
        </button>
      </div>
    </>
  );
}
