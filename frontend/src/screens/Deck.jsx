import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Undo2, X } from "lucide-react";
import { api, queueLength } from "../api";
import { Busy, ErrorBox, Header, PaperCard, PaperFull, PoolChip } from "../components/bits";

const FLY_MS = 240;  // discarded card's flight off-screen; the deck shifts as it lands
const RISE_MS = 200; // the card behind rising and growing into the vacated slot

// Resting pose per depth: the card behind sits low and small, so promoting it is
// just a transition up to the top pose — the next card comes from below, never
// from the side the last one was flung to.
const STACK = [
  { y: 0, scale: 1, opacity: 1 },
  { y: 8, scale: 0.95, opacity: 0.7 },
  { y: 16, scale: 0.9, opacity: 0.4 },
];

const stackStyle = (i) => ({
  transform: `translateY(${STACK[i].y}px) scale(${STACK[i].scale})`,
  opacity: STACK[i].opacity,
  transition: `transform ${RISE_MS}ms ease-out, opacity ${RISE_MS}ms ease-out`,
});

export default function Deck({ go, searchId }) {
  const [deck, setDeck] = useState(null); // null = loading
  const [counts, setCounts] = useState({ kept: 0, skipped: 0, pending: 0 });
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [queueN, setQueueN] = useState(queueLength());
  const [expanded, setExpanded] = useState(false); // full, unclipped view of the top card

  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const [flying, setFlying] = useState(null); // 'left' | 'right'
  const start = useRef({ x: 0, y: 0 });
  const tap = useRef({ at: 0, moved: false });

  useEffect(() => {
    let alive = true;
    api.deck(searchId)
      .then((r) => {
        if (!alive) return;
        setDeck(r.cards);
        setCounts(r.counts);
      })
      .catch((e) => alive && setError(e));
    const onQueue = () => setQueueN(queueLength());
    window.addEventListener("sift-queue", onQueue);
    return () => {
      alive = false;
      window.removeEventListener("sift-queue", onQueue);
    };
  }, [searchId]);

  const commit = (dir) => {
    const top = deck[0];
    if (!top) return;
    const key = dir === "right" ? "kept" : "skipped";
    setDeck(deck.slice(1));
    setCounts((c) => ({ ...c, [key]: c[key] + 1 }));
    setHistory((h) => [...h, { paper: top, dir }]);
    api.decide(searchId, top.paper_id, key).catch(() => {});
    setFlying(null);
    setDrag({ dx: 0, dy: 0, active: false });
  };

  const fly = (dir) => {
    if (flying || !deck || deck.length === 0) return;
    setFlying(dir);
    setTimeout(() => commit(dir), FLY_MS);
  };

  const undo = () => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    const key = last.dir === "right" ? "kept" : "skipped";
    setHistory((h) => h.slice(0, -1));
    setCounts((c) => ({ ...c, [key]: Math.max(0, c[key] - 1) }));
    setDeck((d) => [last.paper, ...d]);
    api.undoDecision(searchId, last.paper.paper_id).catch(() => {});
  };

  const onDown = (e) => {
    if (flying) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* pointer already gone (fast tap) — tracking still works */ }
    start.current = { x: e.clientX, y: e.clientY };
    tap.current = { at: Date.now(), moved: false };
    setDrag({ dx: 0, dy: 0, active: true });
  };
  const onMove = (e) => {
    if (!drag.active || flying) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) tap.current.moved = true;
    setDrag({ dx, dy, active: true });
  };
  const onUp = () => {
    if (!drag.active || flying) return;
    if (!tap.current.moved && Date.now() - tap.current.at < 500) {
      setDrag({ dx: 0, dy: 0, active: false });
      setExpanded(true);
      return;
    }
    if (drag.dx > 110) fly("right");
    else if (drag.dx < -110) fly("left");
    else setDrag({ dx: 0, dy: 0, active: false });
  };

  const decideExpanded = (dir) => {
    setExpanded(false);
    fly(dir);
  };

  const topStyle = flying
    ? {
        transform: `translate(${flying === "right" ? 520 : -520}px, ${drag.dy}px) rotate(${flying === "right" ? 20 : -20}deg)`,
        opacity: 0,
        transition: `transform ${FLY_MS}ms ease-out, opacity ${FLY_MS}ms ease-out`,
        touchAction: "none",
      }
    : drag.active
    ? {
        transform: `translate(${drag.dx}px, ${drag.dy * 0.15}px) rotate(${drag.dx * 0.06}deg)`,
        transition: "none",
        touchAction: "none",
      }
    : {
        transform: "none",
        opacity: 1,
        transition: `transform ${RISE_MS}ms ease-out, opacity ${RISE_MS}ms ease-out`,
        touchAction: "none",
      };

  const stampKeep = flying === "right" ? 1 : Math.min(1, Math.max(0, (drag.dx - 30) / 70));
  const stampSkip = flying === "left" ? 1 : Math.min(1, Math.max(0, (-drag.dx - 30) / 70));

  if (error) {
    return (
      <>
        <Header onBack={() => go("topics")} />
        <div className="px-5 py-6"><ErrorBox error={error} /></div>
      </>
    );
  }
  if (deck === null) {
    return (
      <>
        <Header onBack={() => go("topics")} />
        <Busy>Loading the deck…</Busy>
      </>
    );
  }

  const seen = counts.kept + counts.skipped;
  const total = seen + deck.length;

  return (
    <>
      <Header
        onBack={() => go("topics")}
        right={<PoolChip count={counts.kept} onClick={() => go("pool", { searchId })} />}
      />
      <div className="flex-1 relative px-3 pt-2.5 pb-1.5 overflow-hidden">
        {deck.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
            <p className="font-serif text-2xl text-amber-50">Deck cleared.</p>
            <p className="text-sm text-slate-400">
              {counts.kept} kept · {counts.skipped} skipped
            </p>
            <button
              onClick={() => go("pool", { searchId })}
              className="w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-3.5 active:bg-teal-400"
            >
              Review pool ({counts.kept})
            </button>
            <button
              onClick={() => go("search")}
              className="w-full rounded-xl border border-slate-700 text-slate-300 py-3.5"
            >
              New search
            </button>
          </div>
        ) : (
          <div className="relative h-full">
            {/* Deepest card first and keyed by paper, so a card keeps its own DOM
                node as it is promoted. Positional children would hand the flying
                card's node — mid-flight, off to one side — to the card behind it,
                which then slid back in from the side just swiped to, as if the
                decision had been undone. */}
            {[2, 1, 0].map((i) => {
              const p = deck[i];
              if (!p) return null;
              if (i > 0) {
                return (
                  <div key={p.paper_id} className="absolute inset-0" style={stackStyle(i)}>
                    <PaperCard p={p} />
                  </div>
                );
              }
              return (
                <div
                  key={p.paper_id}
                  className="absolute inset-0 cursor-grab active:cursor-grabbing"
                  style={topStyle}
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                >
                  <PaperCard p={p} stampKeep={stampKeep} stampSkip={stampSkip} tapHint />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Progress and notices ride above the buttons, so the buttons stay pinned
          to the very bottom of the screen where the thumb already is. */}
      {(deck.length > 0 || queueN > 0) && (
        <div className="flex items-center justify-center gap-2 pb-1.5 font-mono text-[11px]">
          {deck.length > 0 && <span className="text-slate-500">{seen + 1} of {total}</span>}
          {deck.length > 0 && seen === 0 && (
            <span className="text-slate-600">· swipe right to keep, left to skip</span>
          )}
          {queueN > 0 && <span className="text-amber-500">· {queueN} queued offline</span>}
        </div>
      )}
      {deck.length > 0 && (
        <div className="flex items-center justify-center gap-8 pb-3">
          <button
            onClick={() => fly("left")}
            aria-label="Skip"
            className="w-16 h-16 rounded-full border-2 border-rose-500 text-rose-400 flex items-center justify-center active:bg-rose-950"
          >
            <X size={28} />
          </button>
          <button
            onClick={undo}
            disabled={history.length === 0}
            aria-label="Undo"
            className="w-11 h-11 rounded-full border border-slate-600 text-slate-400 flex items-center justify-center disabled:opacity-30 active:bg-slate-900"
          >
            <Undo2 size={18} />
          </button>
          <button
            onClick={() => fly("right")}
            aria-label="Add to pool"
            className="w-16 h-16 rounded-full border-2 border-emerald-500 text-emerald-400 flex items-center justify-center active:bg-emerald-950"
          >
            <Check size={28} />
          </button>
        </div>
      )}

      {expanded && deck[0] && (
        <div className="fixed inset-0 z-40 flex justify-center bg-slate-950/80">
          <div className="w-full max-w-md h-full flex flex-col bg-slate-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <span className="font-mono text-xs text-slate-500">{seen + 1} of {total}</span>
              <button
                onClick={() => setExpanded(false)}
                className="p-2 -mr-2 text-slate-400 active:text-slate-200"
                aria-label="Back to deck"
              >
                <ChevronDown size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5">
              <PaperFull p={deck[0]} />
            </div>
            <div className="flex items-center justify-center gap-8 pt-3 pb-3 border-t border-slate-800">
              <button
                onClick={() => decideExpanded("left")}
                aria-label="Skip"
                className="w-14 h-14 rounded-full border-2 border-rose-500 text-rose-400 flex items-center justify-center active:bg-rose-950"
              >
                <X size={24} />
              </button>
              <button
                onClick={() => setExpanded(false)}
                className="rounded-full border border-slate-600 text-slate-400 font-mono text-xs px-4 py-2.5 active:bg-slate-900"
              >
                decide later
              </button>
              <button
                onClick={() => decideExpanded("right")}
                aria-label="Add to pool"
                className="w-14 h-14 rounded-full border-2 border-emerald-500 text-emerald-400 flex items-center justify-center active:bg-emerald-950"
              >
                <Check size={24} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
