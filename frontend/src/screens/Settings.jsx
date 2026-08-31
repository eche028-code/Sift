import { useEffect, useState } from "react";
import { AlertTriangle, Check, RefreshCw, RotateCcw, X, Zap } from "lucide-react";
import { api } from "../api";
import { Busy, Header } from "../components/bits";

// base_url is editable after picking one — presets are a starting point, not a cage.
const PROVIDERS = [
  { key: "DeepSeek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { key: "Moonshot", base_url: "https://api.moonshot.ai/v1", model: "" },
  { key: "Anthropic", base_url: "https://api.anthropic.com/v1/", model: "claude-opus-5" },
  { key: "Custom", base_url: "", model: "" },
];

const FUNCTIONS = [
  { key: "translator", label: "Translator", hint: "turns your question into a PubMed query" },
  { key: "clarifier", label: "Clarifier", hint: "asks narrowing questions when a fetch is too broad" },
  { key: "triage", label: "Triage", hint: "screens and grades every abstract" },
  { key: "synthesis", label: "Synthesis", hint: "writes the evidence note" },
];

const inputCls =
  "w-full rounded-xl bg-slate-900 border border-slate-700 hover:border-slate-600 focus:border-teal-500 focus:outline-none px-4 py-3 text-sm text-slate-100 placeholder-slate-600";
const Label = ({ children }) => (
  <label className="font-mono text-xs uppercase tracking-wide text-slate-500">{children}</label>
);

const ReadyCard = ({ ok, label, detail }) => (
  <div
    className={`items-start gap-2 rounded-xl border px-3 py-2.5 flex-1 min-w-0 ${
      // Settled items are reassurance on a monitor, dead weight on a phone.
      ok ? "hidden sm:flex border-emerald-800 bg-emerald-950/30" : "flex border-amber-800 bg-amber-950/20"
    }`}
  >
    {ok ? (
      <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
    ) : (
      <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
    )}
    <div className="min-w-0">
      <p className={`text-xs font-medium ${ok ? "text-emerald-300" : "text-amber-300"}`}>{label}</p>
      <p className="text-xs text-slate-500 mt-0.5 leading-snug">{detail}</p>
    </div>
  </div>
);

export default function Settings({ go }) {
  const [settings, setSettings] = useState(null);
  const [defaults, setDefaults] = useState({});
  const [apiKey, setApiKey] = useState(""); // typed-but-unsaved; the server never sends one back
  const [test, setTest] = useState(null);
  const [models, setModels] = useState(null);
  const [saved, setSaved] = useState(false);

  const load = async () => {
    const [s, d] = await Promise.all([
      api.getSettings().catch(() => null),
      api.promptDefaults().catch(() => ({})),
    ]);
    setSettings(s);
    setDefaults(d);
  };
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setSettings((s) => ({ ...s, [k]: e.target.value }));
  const patch = (fields) => setSettings((s) => ({ ...s, ...fields }));

  const pickProvider = (p) =>
    patch({
      llm_provider: p.key,
      llm_base_url: p.base_url,
      // Only fill the model if the field is empty or still holds another preset's default.
      llm_model:
        !settings.llm_model || PROVIDERS.some((o) => o.model && o.model === settings.llm_model)
          ? p.model
          : settings.llm_model,
    });

  const save = async () => {
    const body = {
      llm_provider: settings.llm_provider,
      llm_base_url: settings.llm_base_url,
      llm_model: settings.llm_model,
      prompt_translator: settings.prompt_translator,
      prompt_clarifier: settings.prompt_clarifier,
      prompt_triage: settings.prompt_triage,
      prompt_synthesis: settings.prompt_synthesis,
      contact_email: settings.contact_email,
      user_profile: settings.user_profile,
      clarify_threshold: settings.clarify_threshold,
    };
    if (apiKey.trim()) body.llm_api_key = apiKey.trim(); // omitted → server keeps the stored key
    const next = await api.putSettings(body).catch((e) => (window.alert(e.message), null));
    if (!next) return;
    setApiKey("");
    setSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  // Tests what is on screen, including a key typed but not yet saved.
  const draft = () => ({
    base_url: settings.llm_base_url,
    model: settings.llm_model,
    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
  });

  const runTest = async () => {
    setTest({ busy: true });
    setTest(await api.testLlm(draft()).catch((e) => ({ ok: false, error: e.message })));
  };

  const fetchModels = async () => {
    setModels({ busy: true });
    setModels(await api.llmModels(draft()).catch((e) => ({ ok: false, error: e.message, models: [] })));
  };

  if (!settings) {
    return (
      <>
        <Header onBack={() => go("topics")} />
        <Busy />
      </>
    );
  }

  const isAnthropic = settings.llm_provider === "Anthropic";
  const isCustom = settings.llm_provider === "Custom";
  const hasKey = settings.llm_api_key_set || Boolean(apiKey.trim());
  const ready = {
    model: Boolean(settings.llm_base_url?.trim() && settings.llm_model?.trim()),
    key: hasKey || isCustom,
    email: Boolean(settings.contact_email?.trim()),
  };
  const allReady = ready.model && ready.key && ready.email;

  return (
    <>
      <Header onBack={() => go("topics")} />
      <div className="flex-1 overflow-y-auto px-5 py-5 lg:px-8 lg:py-7 flex flex-col gap-8">
        {/* ── setup readiness ── */}
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <Label>Setup</Label>
            <span className={`font-mono text-xs ${allReady ? "text-emerald-400" : "text-amber-400"}`}>
              {allReady ? "ready to search" : "incomplete"}
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:gap-3">
            <ReadyCard
              ok={ready.model}
              label={ready.model ? `${settings.llm_provider || "Model"} · ${settings.llm_model}` : "No model"}
              detail={ready.model ? "used for all four functions" : "pick a provider and enter a model"}
            />
            <ReadyCard
              ok={ready.key}
              label={hasKey ? `API key ····${settings.llm_api_key_last4 || "new"}` : "No API key"}
              detail={hasKey ? "stored on this PC" : isCustom ? "not needed for a local model" : "every request will be rejected"}
            />
            <ReadyCard
              ok={ready.email}
              label={ready.email ? "Contact email set" : "No contact email"}
              detail={ready.email ? "Unpaywall PDF lookup enabled" : "OA PDF links stay empty without it"}
            />
          </div>
        </section>

        {/* Two independent columns on a monitor; unchanged stacking order on the phone. */}
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-10 lg:items-start">
          <div className="flex flex-col gap-8 lg:w-1/2 lg:min-w-0">
            {/* ── the one model ── */}
            <section className="flex flex-col gap-4">
              <Label>Model</Label>
              <div className="flex gap-2 flex-wrap">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => pickProvider(p)}
                    className={`font-mono text-xs rounded px-2.5 py-1.5 border ${
                      settings.llm_provider === p.key
                        ? "border-teal-500 text-teal-300 bg-teal-950/40"
                        : "border-slate-700 text-slate-400 hover:border-teal-600 hover:text-teal-300"
                    }`}
                  >
                    {p.key}
                  </button>
                ))}
              </div>

              <div>
                <p className="text-xs text-slate-500 mb-1.5">API key</p>
                <input
                  className={inputCls}
                  type="password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    settings.llm_api_key_set
                      ? `saved ····${settings.llm_api_key_last4} — type to replace`
                      : isCustom
                        ? "blank for a local model"
                        : "paste your key"
                  }
                />
              </div>

              <div>
                <p className="text-xs text-slate-500 mb-1.5">Model</p>
                <input
                  className={`${inputCls} font-mono`}
                  value={settings.llm_model}
                  onChange={set("llm_model")}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="model name"
                />
              </div>

              <div>
                <p className="text-xs text-slate-500 mb-1.5">Endpoint</p>
                <input
                  className={`${inputCls} font-mono text-xs`}
                  value={settings.llm_base_url}
                  onChange={set("llm_base_url")}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="https://…/v1"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={runTest}
                  className="flex-1 rounded-xl border border-teal-600 text-teal-300 py-2.5 text-sm font-medium hover:bg-teal-950 inline-flex items-center justify-center gap-1.5"
                >
                  {test?.busy ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />} Test
                </button>
                <button
                  onClick={fetchModels}
                  className="flex-1 rounded-xl border border-slate-700 text-slate-300 py-2.5 text-sm hover:bg-slate-900 inline-flex items-center justify-center gap-1.5"
                >
                  {models?.busy ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />} Fetch models
                </button>
              </div>

              {test && !test.busy && (
                <p className={`font-mono text-xs flex items-start gap-1.5 ${test.ok ? "text-emerald-400" : "text-rose-400"}`}>
                  {test.ok ? (
                    <><Check size={12} className="mt-0.5 shrink-0" /> {test.latency_ms} ms · {test.model}</>
                  ) : (
                    <><X size={12} className="mt-0.5 shrink-0" /> <span className="break-all">{test.error}</span></>
                  )}
                </p>
              )}

              {models && !models.busy && (
                models.ok ? (
                  <div className="flex gap-1.5 flex-wrap">
                    {models.models.slice(0, 24).map((m) => (
                      <button
                        key={m}
                        onClick={() => patch({ llm_model: m })}
                        className="font-mono text-xs text-slate-400 border border-slate-800 rounded px-1.5 py-0.5 hover:border-teal-600 hover:text-teal-300"
                      >
                        {m}
                      </button>
                    ))}
                    {models.models.length === 0 && (
                      <p className="font-mono text-xs text-slate-600">endpoint listed no models — type the name yourself</p>
                    )}
                  </div>
                ) : (
                  <p className="font-mono text-xs text-slate-600 break-all">{models.error}</p>
                )
              )}

              {isAnthropic && (
                <p className="flex items-start gap-2 text-xs text-amber-300 bg-amber-950/20 border border-amber-900 rounded-lg px-3 py-2">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span className="leading-snug">
                    Anthropic's OpenAI-compatible endpoint ignores JSON mode, so every function relies on the
                    model following the instructions below. Keep the "reply with JSON only" wording if you edit them.
                  </span>
                </p>
              )}

              <p className="text-xs text-slate-600">
                One model runs the translator, clarifier, triage and synthesis. Steer each separately below.
              </p>
            </section>
          </div>

          <div className="flex flex-col gap-8 lg:w-1/2 lg:min-w-0">
            {/* ── pubmed ── */}
            <section className="flex flex-col gap-4">
              <Label>PubMed</Label>
              <p className="text-xs text-slate-600 -mt-2">
                PubMed needs no account or key. Searches run against the public E-utilities API.
              </p>
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Contact email — needed for Unpaywall PDF lookup</p>
                <input className={inputCls} value={settings.contact_email} onChange={set("contact_email")}
                  type="email" autoCapitalize="none" placeholder="you@example.com" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Reader profile — steers triage and synthesis</p>
                <textarea className={`${inputCls} resize-none`} rows={3} value={settings.user_profile} onChange={set("user_profile")} />
              </div>
            </section>

            {/* ── screening flow ── */}
            <section className="flex flex-col gap-4">
              <Label>Screening</Label>
              <div>
                <p className="text-xs text-slate-500 mb-1.5">
                  Suggest narrowing questions when a fetch would screen more new abstracts than
                </p>
                <input
                  className={`${inputCls} font-mono`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={settings.clarify_threshold}
                  onChange={set("clarify_threshold")}
                  placeholder="30"
                />
                <p className="text-xs text-slate-600 mt-1.5">
                  0 suggests every time. You can always tap "screen anyway" — this is a nudge, not a limit.
                </p>
              </div>
            </section>

          </div>
        </div>

        {/* ── per-function instructions ── */}
        <section>
          <Label>Instructions</Label>
          <p className="text-xs text-slate-500 mt-1.5 mb-2">
            How each function should handle its job. Blank uses the built-in wording. The JSON reply
            format is added automatically and is not editable — the pipeline parses it.
          </p>
          <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
            {FUNCTIONS.map((f) => {
              const field = `prompt_${f.key}`;
              const custom = Boolean(settings[field]?.trim());
              return (
                <div key={f.key} className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm text-slate-200 font-medium">{f.label}</p>
                    {custom && (
                      <button
                        onClick={() => patch({ [field]: "" })}
                        className="font-mono text-xs text-slate-500 hover:text-teal-300 inline-flex items-center gap-1"
                      >
                        <RotateCcw size={11} /> default
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 mb-2.5">{f.hint}</p>
                  <textarea
                    rows={7}
                    value={settings[field]}
                    onChange={set(field)}
                    placeholder={defaults[f.key] || ""}
                    className="w-full flex-1 rounded-lg bg-slate-950 border border-slate-700 hover:border-slate-600 focus:border-teal-500 focus:outline-none text-xs text-slate-200 px-3 py-2.5 leading-relaxed resize-y"
                  />
                  <p className="font-mono text-xs text-slate-600 mt-1.5">{custom ? "custom" : "using built-in"}</p>
                </div>
              );
            })}
          </div>
        </section>

        <button
          onClick={save}
          className="rounded-xl bg-teal-500 text-slate-950 font-semibold py-3 hover:bg-teal-400 mb-6"
        >
          {saved ? "Saved ✓" : "Save"}
        </button>
      </div>
    </>
  );
}
