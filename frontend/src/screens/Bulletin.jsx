import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, Newspaper, X } from "lucide-react";
import { api } from "../api";
import { Busy, GearButton, Header, NavMenu } from "../components/bits";

const ago = (iso) => {
  if (!iso) return "never";
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const Item = ({ item, open, onToggle, onDismiss, onPromote }) => (
  <div
    onClick={onToggle}
    className="rounded-xl border border-slate-800 bg-slate-900 p-4 cursor-pointer active:border-teal-600"
  >
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className={`font-serif text-amber-50 leading-snug ${open ? "" : "line-clamp-3"}`}>
          {item.title}
        </p>
        <p className="font-mono text-xs text-slate-500 mt-1.5 truncate">
          {[item.journal, item.year].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        className="p-1.5 -mr-1.5 -mt-1.5 text-slate-600 active:text-rose-400 shrink-0"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
    {open && (
      <div onClick={(e) => e.stopPropagation()}>
        {item.authors && <p className="text-xs text-slate-500 mt-2">{item.authors}</p>}
        {item.abstract && (
          <p className="text-sm text-slate-400 mt-3 leading-relaxed line-clamp-[12] whitespace-pre-line">
            {item.abstract}
          </p>
        )}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onPromote}
            className="flex-1 rounded-lg bg-teal-500 text-slate-950 text-sm font-semibold py-2.5 active:bg-teal-400"
          >
            Ask about this
          </button>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-700 text-slate-300 px-3 py-2.5 inline-flex items-center gap-1.5 text-sm"
            >
              PubMed <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
    )}
  </div>
);

export default function Bulletin({ go }) {
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);

  const refresh = () => api.bulletin().then(setData).catch(() => {});
  useEffect(() => {
    // the server owns staleness — this no-ops unless a watched topic is due
    api.pollBulletin().catch(() => {}).finally(refresh);
  }, []);
  useEffect(() => {
    if (!data?.poll_running) return;
    const timer = setTimeout(refresh, 1500);
    return () => clearTimeout(timer);
  }, [data]);

  const checkNow = () => {
    api.pollBulletin({ force: true }).catch(() => {}).finally(refresh);
  };
  const dismiss = async (item) => {
    await api.dismissBulletinItem(item.id).catch(() => {});
    refresh();
  };
  const promote = (item) => {
    api.promoteBulletinItem(item.id).catch(() => {});
    go("search", { prefill: item.title });
  };
  const clearTopic = async (t) => {
    await api.dismissAllBulletin(t.search_id).catch(() => {});
    refresh();
  };
  const runTopic = async (t) => {
    try {
      await api.runSearch(t.search_id);
      go("scanning", { searchId: t.search_id });
    } catch (e) {
      go(e.status === 400 ? "filters" : "scanning", { searchId: t.search_id });
    }
  };

  const topics = data?.topics || [];
  const lastChecked = topics.map((t) => t.watch_checked_at).filter(Boolean).sort().at(-1);

  return (
    <>
      <Header
        menu={<NavMenu go={go} current="bulletin" />}
        right={<GearButton onClick={() => go("settings")} />}
      />
      <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-6">
        <div>
          <p className="font-serif text-xl text-amber-50 leading-snug inline-flex items-center gap-2">
            <Newspaper size={18} className="text-amber-300" /> Bulletin
          </p>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">
            New PubMed matches for your watched topics — collected free, screened
            only when you ask.
          </p>
          <p className="font-mono text-xs mt-2">
            {data?.poll_running ? (
              <span className="text-teal-400 animate-pulse">checking PubMed…</span>
            ) : (
              <span className="text-slate-500">
                checked {ago(lastChecked)} ·{" "}
                <button onClick={checkNow} className="text-teal-400 underline underline-offset-2">
                  check now
                </button>
              </span>
            )}
          </p>
        </div>

        {data === null ? (
          <Busy />
        ) : topics.length === 0 ? (
          <div className="flex flex-col gap-4 mt-8">
            <p className="text-sm text-slate-500 text-center px-6 leading-relaxed">
              Nothing is watched yet. Bookmark a topic, then tap its feed icon —
              new PubMed matches will collect here without spending a token.
            </p>
            <button
              onClick={() => go("topics")}
              className="mx-auto rounded-xl border border-slate-700 text-slate-300 px-5 py-3 inline-flex items-center gap-2"
            >
              Go to your topics <ChevronRight size={16} />
            </button>
          </div>
        ) : (
          topics.map((t) => (
            <div key={t.search_id}>
              <div className="flex items-baseline gap-2 mb-2">
                <p className="font-mono text-xs uppercase tracking-wide text-slate-500 flex-1 truncate">
                  {t.raw_query}
                </p>
                {t.items.length > 0 && (
                  <button
                    onClick={() => clearTopic(t)}
                    className="font-mono text-xs text-slate-500 active:text-slate-300 shrink-0"
                  >
                    clear all
                  </button>
                )}
              </div>
              {t.items.length === 0 ? (
                <p className="text-sm text-slate-600">
                  Nothing new{t.watch_checked_at ? ` — checked ${ago(t.watch_checked_at)}` : ""}.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {t.items.map((item) => (
                    <Item
                      key={item.id}
                      item={item}
                      open={openId === item.id}
                      onToggle={() => setOpenId(openId === item.id ? null : item.id)}
                      onDismiss={() => dismiss(item)}
                      onPromote={() => promote(item)}
                    />
                  ))}
                  <button
                    onClick={() => runTopic(t)}
                    className="rounded-xl border border-teal-700 text-teal-300 text-sm font-medium py-3 active:bg-teal-950"
                  >
                    Run this search — screens only what's new
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}
