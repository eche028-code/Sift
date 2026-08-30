import { useEffect, useState } from "react";
import { Check, Plus, RefreshCw, Trash2, X, Zap } from "lucide-react";
import { api } from "../api";
import { Busy, Header } from "../components/bits";

const PRESETS = [
  { name: "DeepSeek", base_url: "https://api.deepseek.com/v1" },
  { name: "OpenRouter", base_url: "https://openrouter.ai/api/v1" },
  { name: "Groq", base_url: "https://api.groq.com/openai/v1" },
  { name: "Ollama", base_url: "http://localhost:11434/v1" },
];

const ROLES = [
  { key: "translator", label: "Translator", hint: "natural language → PubMed syntax · small and cheap" },
  { key: "triage", label: "Triage", hint: "screens every abstract · cheapest capable model" },
  { key: "synthesis", label: "Synthesis", hint: "writes the evidence notes · your best model" },
];

const inputCls =
  "w-full rounded-xl bg-slate-900 border border-slate-700 focus:border-teal-500 focus:outline-none px-4 py-3 text-sm text-slate-100 placeholder-slate-600";
const Label = ({ children }) => (
  <label className="font-mono text-xs uppercase tracking-wide text-slate-500">{children}</label>
);

export default function Settings({ go }) {
  const [providers, setProviders] = useState(null);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ name: "", base_url: "", api_key: "" });
  const [adding, setAdding] = useState(false);
  const [tests, setTests] = useState({}); // provider id → result
  const [roleDraft, setRoleDraft] = useState({}); // role → {provider_id, model}
  const [crawlSaved, setCrawlSaved] = useState(false);
  const [crawlMsg, setCrawlMsg] = useState("");
  const [log, setLog] = useState([]);

  const load = async () => {
    const [p, s, l] = await Promise.all([
      api.listProviders().catch(() => []),
      api.getSettings().catch(() => null),
      api.crawlLog().catch(() => []),
    ]);
    setProviders(p);
    setSettings(s);
    setLog(l);
    const roles = {};
    for (const r of ROLES) roles[r.key] = s?.roles?.[r.key] || { provider_id: "", model: "" };
    setRoleDraft(roles);
  };
  useEffect(() => { load(); }, []);

  const addProvider = async () => {
    if (!form.name.trim() || !form.base_url.trim() || adding) return;
    setAdding(true);
    try {
      await api.addProvider(form);
      setForm({ name: "", base_url: "", api_key: "" });
      await load();
    } catch (e) {
      window.alert(e.message);
    } finally {
      setAdding(false);
    }
  };

  const delProvider = async (p) => {
    if (!window.confirm(`Remove provider "${p.name}"? Roles using it will be cleared.`)) return;
    await api.deleteProvider(p.id).catch(() => {});
    await load();
  };

  const test = async (p) => {
    setTests((t) => ({ ...t, [p.id]: { busy: true } }));
    const r = await api.testProvider(p.id).catch((e) => ({ ok: false, error: e.message }));
    setTests((t) => ({ ...t, [p.id]: r }));
  };

  const saveRole = async (roleKey, draft) => {
    const complete = draft.provider_id && draft.model.trim();
    await api
      .putSettings({ roles: { [roleKey]: complete ? { provider_id: Number(draft.provider_id), model: draft.model.trim() } : null } })
      .catch((e) => window.alert(e.message));
  };
  const setRole = (roleKey, patch, save = false) => {
    setRoleDraft((d) => {
      const next = { ...d, [roleKey]: { ...d[roleKey], ...patch } };
      if (save) saveRole(roleKey, next[roleKey]);
      return next;
    });
  };

  const saveCrawl = async () => {
    await api
      .putSettings({
        ncbi_api_key: settings.ncbi_api_key,
        contact_email: settings.contact_email,
        backfill_floor_year: settings.backfill_floor_year,
        crawl_day: settings.crawl_day,
        backfill_window_months: settings.backfill_window_months,
        user_profile: settings.user_profile,
      })
      .catch((e) => window.alert(e.message));
    setCrawlSaved(true);
    setTimeout(() => setCrawlSaved(false), 1500);
  };

  const runCrawl = async () => {
    setCrawlMsg("starting…");
    const r = await api.runCrawl().catch((e) => ({ started: false, reason: e.message }));
    setCrawlMsg(r.started ? "crawl running — check the log below in a minute" : r.reason);
  };

  if (!providers || !settings) {
    return (
      <>
        <Header onBack={() => go("topics")} />
        <Busy />
      </>
    );
  }

  const set = (k) => (e) => setSettings((s) => ({ ...s, [k]: e.target.value }));

  return (
    <>
      <Header onBack={() => go("topics")} />
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-8">
        {/* ── providers ── */}
        <section>
          <Label>Models · providers</Label>
          <div className="flex flex-col gap-3 mt-2">
            {providers.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-slate-200 font-medium flex-1 truncate">{p.name}</p>
                  <button
                    onClick={() => test(p)}
                    className="font-mono text-xs text-teal-300 border border-teal-700 rounded px-2 py-1 active:bg-teal-950 inline-flex items-center gap-1"
                  >
                    {tests[p.id]?.busy ? <RefreshCw size={11} className="animate-spin" /> : <Zap size={11} />}
                    Test
                  </button>
                  <button onClick={() => delProvider(p)} className="p-1 text-slate-600 active:text-rose-400" aria-label="Delete provider">
                    <Trash2 size={15} />
                  </button>
                </div>
                <p className="font-mono text-xs text-slate-500 mt-1 truncate">{p.base_url}</p>
                <p className="font-mono text-xs text-slate-600 mt-0.5">
                  key {p.has_key ? `····${p.key_last4}` : "— none (local model)"}
                </p>
                {tests[p.id] && !tests[p.id].busy && (
                  <p className={`font-mono text-xs mt-2 flex items-start gap-1.5 ${tests[p.id].ok ? "text-emerald-400" : "text-rose-400"}`}>
                    {tests[p.id].ok ? (
                      <><Check size={12} className="mt-0.5 shrink-0" /> {tests[p.id].latency_ms} ms · {tests[p.id].model}</>
                    ) : (
                      <><X size={12} className="mt-0.5 shrink-0" /> <span className="break-all">{tests[p.id].error}</span></>
                    )}
                  </p>
                )}
              </div>
            ))}

            <div className="rounded-xl border border-dashed border-slate-700 p-4 flex flex-col gap-2.5">
              <div className="flex gap-2 flex-wrap">
                {PRESETS.map((pr) => (
                  <button
                    key={pr.name}
                    onClick={() => setForm((f) => ({ ...f, name: pr.name, base_url: pr.base_url }))}
                    className="font-mono text-xs text-slate-400 border border-slate-700 rounded px-2 py-1 active:border-teal-600 active:text-teal-300"
                  >
                    {pr.name}
                  </button>
                ))}
              </div>
              <input className={inputCls} placeholder="Name (e.g. DeepSeek)" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              <input className={inputCls} placeholder="Base URL (…/v1)" value={form.base_url}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => setForm((f) => ({ ...f, base_url: e.target.value }))} />
              <input className={inputCls} placeholder="API key (blank for local)" value={form.api_key}
                type="password" autoCapitalize="none"
                onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} />
              <button
                onClick={addProvider}
                disabled={!form.name.trim() || !form.base_url.trim() || adding}
                className="rounded-xl border border-teal-600 text-teal-300 py-2.5 text-sm font-medium disabled:opacity-30 active:bg-teal-950 inline-flex items-center justify-center gap-1.5"
              >
                <Plus size={15} /> Add provider
              </button>
            </div>
          </div>
        </section>

        {/* ── roles ── */}
        <section>
          <Label>Model roles</Label>
          <div className="flex flex-col gap-3 mt-2">
            {ROLES.map((r) => (
              <div key={r.key} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-sm text-slate-200 font-medium">{r.label}</p>
                <p className="text-xs text-slate-500 mt-0.5 mb-2.5">{r.hint}</p>
                <div className="flex gap-2">
                  <select
                    value={roleDraft[r.key]?.provider_id || ""}
                    onChange={(e) => setRole(r.key, { provider_id: e.target.value }, true)}
                    className="rounded-lg bg-slate-950 border border-slate-700 text-sm text-slate-200 px-2 py-2 max-w-[45%]"
                  >
                    <option value="">— provider —</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <input
                    value={roleDraft[r.key]?.model || ""}
                    onChange={(e) => setRole(r.key, { model: e.target.value })}
                    onBlur={() => saveRole(r.key, roleDraft[r.key])}
                    placeholder="model name"
                    autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-700 focus:border-teal-500 focus:outline-none font-mono text-xs text-slate-200 px-3 py-2"
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-2">
            Changes save automatically. e.g. DeepSeek: <span className="font-mono">deepseek-chat</span> for all three roles.
          </p>
        </section>

        {/* ── pubmed & crawl ── */}
        <section className="flex flex-col gap-4">
          <Label>PubMed &amp; crawl</Label>
          <div>
            <p className="text-xs text-slate-500 mb-1.5">NCBI API key — optional, raises the rate limit</p>
            <input className={inputCls} value={settings.ncbi_api_key} onChange={set("ncbi_api_key")}
              autoCapitalize="none" spellCheck={false} placeholder="none" />
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1.5">Contact email — needed for Unpaywall PDF lookup</p>
            <input className={inputCls} value={settings.contact_email} onChange={set("contact_email")}
              type="email" autoCapitalize="none" placeholder="you@example.com" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-xs text-slate-500 mb-1.5">Backfill floor</p>
              <input className={inputCls} value={settings.backfill_floor_year} onChange={set("backfill_floor_year")} inputMode="numeric" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1.5">Crawl day</p>
              <input className={inputCls} value={settings.crawl_day} onChange={set("crawl_day")} inputMode="numeric" />
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1.5">Window (mo)</p>
              <input className={inputCls} value={settings.backfill_window_months} onChange={set("backfill_window_months")} inputMode="numeric" />
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1.5">Reader profile — steers triage and synthesis</p>
            <textarea className={`${inputCls} resize-none`} rows={3} value={settings.user_profile} onChange={set("user_profile")} />
          </div>
          <button
            onClick={saveCrawl}
            className="rounded-xl bg-teal-500 text-slate-950 font-semibold py-3 active:bg-teal-400"
          >
            {crawlSaved ? "Saved ✓" : "Save"}
          </button>
        </section>

        {/* ── crawl now + log ── */}
        <section className="pb-6">
          <Label>Monthly crawl</Label>
          <button
            onClick={runCrawl}
            className="mt-2 w-full rounded-xl border border-slate-700 text-slate-300 py-3 inline-flex items-center justify-center gap-2 active:bg-slate-900"
          >
            <RefreshCw size={15} /> Run crawl now
          </button>
          {crawlMsg && <p className="font-mono text-xs text-slate-500 mt-2">{crawlMsg}</p>}
          {log.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              {log.slice(0, 6).map((row) => (
                <p key={row.id} className="font-mono text-xs text-slate-600">
                  {row.ran_at?.slice(0, 10)} · {row.window_from} → {row.window_to} ·{" "}
                  {row.status === "ok" ? (
                    <span className="text-slate-500">{row.found} found, {row.new_papers} new</span>
                  ) : (
                    <span className="text-rose-400">error</span>
                  )}
                </p>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
