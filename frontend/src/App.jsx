import { useEffect, useState } from "react";
import { flushQueue } from "./api";
import Deck from "./screens/Deck";
import Detail from "./screens/Detail";
import Filters from "./screens/Filters";
import Help from "./screens/Help";
import NotesList from "./screens/NotesList";
import NoteView from "./screens/NoteView";
import Pool from "./screens/Pool";
import Results from "./screens/Results";
import Scanning from "./screens/Scanning";
import SearchScreen from "./screens/Search";
import Settings from "./screens/Settings";
import Topics from "./screens/Topics";

export default function App() {
  const [nav, setNav] = useState({ screen: "search" });
  const go = (screen, extra = {}) => setNav({ screen, ...extra });

  useEffect(() => {
    flushQueue();
  }, []);

  const s = nav.screen;
  // Settings doubles as the desktop setup console, so it alone escapes the phone column.
  const wide = s === "settings";
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-200 font-sans flex justify-center">
      <div
        className={`w-full h-dvh overflow-hidden flex flex-col bg-slate-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ${wide ? "max-w-md lg:max-w-5xl" : "max-w-md"}`}
      >
        {s === "topics" && <Topics go={go} />}
        {s === "search" && <SearchScreen go={go} />}
        {s === "filters" && <Filters go={go} search={nav.search} searchId={nav.searchId ?? nav.search?.id} />}
        {s === "scanning" && <Scanning go={go} searchId={nav.searchId} />}
        {s === "results" && <Results go={go} searchId={nav.searchId} />}
        {s === "deck" && <Deck go={go} searchId={nav.searchId} />}
        {s === "pool" && <Pool go={go} searchId={nav.searchId} />}
        {s === "detail" && <Detail go={go} searchId={nav.searchId} paper={nav.paper} />}
        {s === "note" && (
          <NoteView key={nav.noteId ?? "gen"} go={go} searchId={nav.searchId}
            noteId={nav.noteId} generate={nav.generate} backTo={nav.backTo} />
        )}
        {s === "notes" && <NotesList go={go} />}
        {s === "help" && <Help go={go} />}
        {s === "settings" && <Settings go={go} />}
      </div>
    </div>
  );
}
