import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../api";
import { Busy, Header } from "../components/bits";

export default function NotesList({ go }) {
  const [notes, setNotes] = useState(null);

  const load = () => api.listNotes().then(setNotes).catch(() => setNotes([]));
  useEffect(() => { load(); }, []);

  const del = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm("Delete this note?")) return;
    await api.deleteNote(id).catch(() => {});
    load();
  };

  return (
    <>
      <Header onBack={() => go("topics")} />
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
        </div>
      )}
    </>
  );
}
