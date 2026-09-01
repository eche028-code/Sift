import { useEffect, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { api } from "../api";
import { Busy, GearButton, Header, NavMenu } from "../components/bits";

export default function NotesList({ go }) {
  const [notes, setNotes] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.listNotes().then(setNotes).catch(() => setNotes([]));
  useEffect(() => { load(); }, []);

  // Batch export covers re-seeding Codex, so it re-emits only notes that have
  // already been through the review dialog — the rest have no confirmed tags.
  const exportReviewed = async () => {
    setBusy(true);
    try {
      const frags = await api.noteFragments();
      if (!frags.length) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(frags, null, 1)], { type: "application/json" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "sift-notes.fragment.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* offline or nothing reviewed — the button just no-ops */ }
    setBusy(false);
  };

  const del = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Delete this note?")) return;
    await api.deleteNote(id).catch(() => {});
    load();
  };

  return (
    <>
      <Header
        menu={<NavMenu go={go} current="notes" />}
        right={<GearButton onClick={() => go("settings")} />}
      />
      {notes === null ? (
        <Busy />
      ) : (
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <p className="font-mono text-xs uppercase tracking-wide text-slate-500">Evidence notes</p>
          {notes.length === 0 && (
            <p className="text-sm text-slate-500 text-center mt-16">
              No notes yet — keep some papers and synthesise them.
            </p>
          )}
          {notes.map((n) => (
            <div
              key={n.id}
              onClick={() => go("note", { noteId: n.id, backTo: "notes" })}
              className="rounded-xl border border-slate-800 bg-slate-900 p-4 active:border-teal-600 cursor-pointer"
            >
              <p className="font-serif text-amber-50 leading-snug">{n.title}</p>
              <div className="flex items-center mt-1.5">
                <p className="font-mono text-xs text-slate-500">
                  {n.created_at?.slice(0, 10)} · {n.paper_ids.length} paper{n.paper_ids.length === 1 ? "" : "s"}
                  {n.exported_at && <span className="text-teal-600"> · in codex</span>}
                </p>
                <button
                  onClick={(e) => del(e, n.id)}
                  className="ml-auto p-1 -m-1 text-slate-600 active:text-rose-400"
                  aria-label="Delete note"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {notes.some((n) => n.exported_at) && (
            <button
              onClick={exportReviewed}
              disabled={busy}
              className="mt-1 mb-4 w-full rounded-xl border border-slate-800 text-slate-400 py-3 inline-flex items-center justify-center gap-2 active:bg-slate-900 disabled:opacity-50"
            >
              <Upload size={15} />
              {busy ? "Building…" : "Export reviewed notes as one file"}
            </button>
          )}
        </div>
      )}
    </>
  );
}
