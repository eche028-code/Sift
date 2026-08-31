import { useEffect, useRef, useState } from "react";
import { CheckCheck, Copy, Sparkles } from "lucide-react";
import { api } from "../api";
import { ErrorBox, Header, Markdown } from "../components/bits";

export default function NoteView({ go, searchId, noteId, generate, backTo = "pool" }) {
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // never double-fire the synthesis POST
    ran.current = true;
    let alive = true;
    const load = async () => {
      try {
        if (!generate) {
          const n = await api.getNote(noteId);
          if (alive) setNote(n);
          return;
        }
        // Synthesis runs as a server task (the model call is minutes-slow on a
        // thinking model); fire it — unless one is already running — then poll.
        const st0 = await api.status(searchId).catch(() => null);
        if (st0?.stage_detail?.synthesis_status !== "running") await api.synthesise(searchId);
        for (;;) {
          await new Promise((r) => setTimeout(r, 900));
          if (!alive) return;
          const st = await api.status(searchId).catch(() => null); // transient miss — keep polling
          const d = st?.stage_detail;
          if (!d || d.synthesis_status === "running") continue;
          if (d.synthesis_status === "error") throw new Error(d.synthesis_error || "synthesis failed");
          const n = await api.getNote(d.synthesis_note_id);
          if (alive) setNote(n);
          return;
        }
      } catch (e) {
        if (alive) setError(e);
      }
    };
    load();
    return () => { alive = false; };
  }, []);

  const back = () =>
    backTo === "notes" ? go("notes") : go("pool", { searchId: searchId ?? note?.search_id });

  const copyNote = async () => {
    try {
      await navigator.clipboard.writeText(`${note.title}\n\n${note.body_md}`);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(""), 1800);
  };

  return (
    <>
      <Header onBack={back} />
      {error ? (
        <div className="px-5 py-5">
          <ErrorBox error={error} />
        </div>
      ) : !note ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Sparkles size={22} className="text-teal-400 animate-pulse" />
          <p className="font-mono text-sm text-slate-400">
            {generate ? "Synthesising the pool…" : "Loading note…"}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="rounded-2xl bg-amber-50 text-stone-900 p-5 shadow-2xl">
            <p className="font-mono text-xs text-stone-500 mb-2">
              {generate ? "Draft · " : ""}generated from {note.paper_ids.length} kept paper
              {note.paper_ids.length === 1 ? "" : "s"} · {note.created_at?.slice(0, 10)}
            </p>
            <h2 className="font-serif text-xl leading-snug mb-3">{note.title}</h2>
            <Markdown text={note.body_md} />
          </div>
          <button
            onClick={copyNote}
            className="mt-4 w-full rounded-xl border border-slate-700 text-slate-300 py-3.5 inline-flex items-center justify-center gap-2 active:bg-slate-900"
          >
            {copied === "ok" ? (
              <><CheckCheck size={16} className="text-emerald-500" /> Copied</>
            ) : copied === "fail" ? (
              "Copy failed — long-press to select"
            ) : (
              <><Copy size={16} /> Copy note</>
            )}
          </button>
        </div>
      )}
    </>
  );
}
