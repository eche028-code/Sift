import { useEffect, useState } from "react";
import {
  Bookmark, BookmarkCheck, ChevronRight, FileText, Layers,
  Settings as SettingsIcon, Trash2,
} from "lucide-react";
import { api } from "../api";
import { Busy, Wordmark } from "../components/bits";

const RUNNING_STAGES = ["translating", "searching", "screening"];

const stageLine = (row) => {
  if (RUNNING_STAGES.includes(row.stage)) return "running — tap to watch";
  if (row.stage === "error") return "error — tap for details";
  if (row.stage === "new") return "translated, not run yet";
  const c = row.counts;
  const bits = [];
  if (c.pending > 0) bits.push(`${c.pending} to review`);
  if (c.kept > 0) bits.push(`${c.kept} kept`);
  return bits.join(" · ") || "deck cleared";
};

const Row = ({ row, onOpen, onToggleSave, onDelete }) => (
  <div
    onClick={onOpen}
    className="rounded-xl border border-slate-800 bg-slate-900 p-4 active:border-teal-600 cursor-pointer"
  >
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-serif text-amber-50 leading-snug">{row.raw_query}</p>
        <p className={`font-mono text-xs mt-1.5 ${RUNNING_STAGES.includes(row.stage) ? "text-teal-400 animate-pulse" : row.stage === "error" ? "text-rose-400" : "text-slate-500"}`}>
          {stageLine(row)}
        </p>
      </div>
      {row.counts.pending > 0 && (
        <span className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-teal-500 text-teal-300 font-mono text-xs px-2.5 py-1">
          <Layers size={13} /> {row.counts.pending}
        </span>
      )}
    </div>
    <div className="flex items-center gap-1 mt-2 -mb-1 -ml-1">
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSave(); }}
        className={`p-1.5 ${row.is_saved ? "text-teal-400" : "text-slate-600"} active:text-teal-300`}
        aria-label={row.is_saved ? "Remove from kept topics" : "Keep this topic"}
      >
        {row.is_saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
      </button>
      {!row.is_saved && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 text-slate-600 active:text-rose-400"
          aria-label="Delete search"
        >
          <Trash2 size={16} />
        </button>
      )}
      <span className="ml-auto text-slate-600"><ChevronRight size={16} /></span>
    </div>
  </div>
);

export default function Topics({ go }) {
  const [searches, setSearches] = useState(null);
  const [notes, setNotes] = useState([]);
  const [config, setConfig] = useState(null);

  const load = () => {
    api.listSearches().then(setSearches).catch(() => setSearches([]));
    api.listNotes().then(setNotes).catch(() => {});
    api.getSettings().then(setConfig).catch(() => setConfig(null));
  };
  useEffect(load, []);

  const openRow = (row) => {
    if (RUNNING_STAGES.includes(row.stage) || row.stage === "error") go("scanning", { searchId: row.id });
    else if (row.stage === "new") go("filters", { searchId: row.id });
    else go("deck", { searchId: row.id });
  };
  const toggleSave = async (row) => {
    await api.patchSearch(row.id, { is_saved: !row.is_saved }).catch(() => {});
    load();
  };
  const del = async (row) => {
    if (!window.confirm("Delete this search and its swipe history?")) return;
    await api.deleteSearch(row.id).catch(() => {});
    load();
  };

  const saved = (searches || []).filter((x) => x.is_saved);
  const recent = (searches || []).filter((x) => !x.is_saved).slice(0, 10);
  const needsSetup = config !== null && !(config.llm_base_url?.trim() && config.llm_model?.trim());

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-5 pt-14 pb-4 flex items-start justify-between">
        <div>
          <Wordmark />
          <p className="text-sm text-slate-400 mt-2">AI-screened papers, one card at a time.</p>
        </div>
        <button
          onClick={() => go("settings")}
          className="p-2 -mr-2 mt-1 text-slate-400 active:text-teal-300"
          aria-label="Settings"
        >
          <SettingsIcon size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-6">
        {searches === null ? (
          <Busy />
        ) : (
          <>
            {needsSetup && (
              <button
                onClick={() => go("settings")}
                className="text-left rounded-xl border border-teal-700 bg-teal-950/40 p-4"
              >
                <p className="text-sm text-teal-200 font-medium">Connect a model to begin</p>
                <p className="text-xs text-slate-400 mt-1">
                  Pick a provider, paste an API key and name a model in Settings.
                </p>
              </button>
            )}

            {saved.length > 0 && (
              <div>
                <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">
                  Kept topics
                </p>
                <div className="flex flex-col gap-3">
                  {saved.map((row) => (
                    <Row key={row.id} row={row} onOpen={() => openRow(row)}
                      onToggleSave={() => toggleSave(row)} onDelete={() => del(row)} />
                  ))}
                </div>
              </div>
            )}

            {recent.length > 0 && (
              <div>
                <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">
                  Recent searches
                </p>
                <div className="flex flex-col gap-3">
                  {recent.map((row) => (
                    <Row key={row.id} row={row} onOpen={() => openRow(row)}
                      onToggleSave={() => toggleSave(row)} onDelete={() => del(row)} />
                  ))}
                </div>
              </div>
            )}

            {notes.length > 0 && (
              <div>
                <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">Library</p>
                <button
                  onClick={() => go("notes")}
                  className="w-full text-left rounded-xl border border-slate-800 bg-slate-900 p-4 active:border-teal-600 flex items-center gap-3"
                >
                  <FileText size={16} className="text-teal-400 shrink-0" />
                  <span className="text-sm text-slate-300 flex-1">Evidence notes</span>
                  <span className="font-mono text-xs text-slate-500">{notes.length}</span>
                  <ChevronRight size={16} className="text-slate-600" />
                </button>
              </div>
            )}

            {searches.length === 0 && !needsSetup && (
              <p className="text-sm text-slate-500 text-center mt-16 px-6">
                Ask a clinical question and screen the literature — your searches will live here.
              </p>
            )}
          </>
        )}
      </div>

      <div className="px-5 pb-8 pt-2">
        <button
          onClick={() => go("search")}
          className="w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-4 active:bg-teal-400 inline-flex items-center justify-center gap-2"
        >
          New search <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
