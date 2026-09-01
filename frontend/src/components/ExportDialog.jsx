import { useEffect, useMemo, useState } from "react";
import { Check, CheckCheck, Copy, Download, Plus, X } from "lucide-react";
import { api } from "../api";
import { Busy, ErrorBox } from "./bits";

const norm = (s) =>
  (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Hand the fragment to the machine Codex runs on: a file, or the clipboard. */
function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const Chip = ({ children, onClick, tone = "off", icon: Icon }) => {
  const tones = {
    on: "bg-teal-500 text-slate-950 border-teal-500",
    off: "border-slate-700 text-slate-300",
    warn: "border-amber-600 text-amber-400",
  };
  return (
    <button
      onClick={onClick}
      className={`font-mono text-xs rounded-full border px-2.5 py-1 inline-flex items-center gap-1 ${tones[tone]}`}
    >
      {children}
      {Icon && <Icon size={12} />}
    </button>
  );
};

export default function ExportDialog({ noteId, onClose, onExported }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tags, setTags] = useState([]);
  const [reflection, setReflection] = useState("");
  const [filter, setFilter] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [result, setResult] = useState(null); // {filename, fragment} once confirmed
  const [copied, setCopied] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.noteExportReview(noteId)
      .then((d) => {
        if (!alive) return;
        setData(d);
        // A note reviewed before keeps its confirmed tags; a fresh one starts from
        // Sift's suggestions, which still have to be confirmed here before they ship.
        setTags(d.tags.length ? d.tags : d.suggested_tags);
        setReflection(d.reflection || "");
      })
      .catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [noteId]);

  const taxonomy = data?.taxonomy || [];
  const inTaxonomy = useMemo(() => new Set(taxonomy), [taxonomy]);
  const typed = norm(filter);
  const options = useMemo(() => {
    if (!typed) return (data?.suggested_tags || []).filter((t) => !tags.includes(t)).slice(0, 12);
    return taxonomy.filter((t) => !tags.includes(t) && t.includes(typed)).slice(0, 12);
  }, [taxonomy, tags, typed, data]);

  const toggle = (t) =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const addTyped = () => {
    if (typed && !tags.includes(typed)) setTags([...tags, typed]);
    setFilter("");
  };

  const preview = useMemo(() => {
    if (!data) return "";
    const frag = { ...data.fragment, tags };
    if (reflection.trim()) frag.reflection = reflection.trim();
    else delete frag.reflection;
    return JSON.stringify(frag, null, 1);
  }, [data, tags, reflection]);

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.exportNote(noteId, { tags, reflection: reflection.trim() || null });
      setResult(r);
      onExported?.();
      return r;
    } catch (e) {
      setError(e);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const doCopy = async () => {
    const r = result || (await confirm());
    if (!r) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(r.fragment, null, 1));
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(""), 2000);
  };

  const doDownload = async () => {
    const r = result || (await confirm());
    if (r) download(r.filename, JSON.stringify(r.fragment, null, 1));
  };

  const offTaxonomy = tags.filter((t) => taxonomy.length && !inTaxonomy.has(t));

  return (
    <div className="absolute inset-0 z-30 bg-slate-950/95 flex flex-col">
      <div className="flex items-center px-5 py-4 border-b border-slate-800">
        <p className="font-mono text-xs uppercase tracking-wide text-slate-400">Export to Codex</p>
        <button onClick={onClose} className="ml-auto p-1 -m-1 text-slate-500" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      {error && <div className="px-5 py-4"><ErrorBox error={error} /></div>}
      {!data && !error ? (
        <Busy />
      ) : data ? (
        <>
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
            {/* tags */}
            <div>
              <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">Tags</p>
              {!data.taxonomy_loaded && (
                <p className="text-xs text-amber-400/90 leading-relaxed mb-2">
                  No Codex taxonomy loaded — suggestions are off and anything you type is
                  unchecked. Export the vocabulary from Codex
                  (<span className="font-mono">anchors.export_taxonomy_yaml</span>) and paste it
                  under Settings, Codex.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {tags.length === 0 && (
                  <p className="text-sm text-slate-500">
                    None yet — pick from the vocabulary below.
                  </p>
                )}
                {tags.map((t) => (
                  <Chip
                    key={t}
                    tone={inTaxonomy.has(t) || !taxonomy.length ? "on" : "warn"}
                    onClick={() => toggle(t)}
                    icon={X}
                  >
                    {t}
                  </Chip>
                ))}
              </div>
              {offTaxonomy.length > 0 && (
                <p className="text-xs text-amber-400/90 mb-2">
                  Not in the Codex vocabulary: {offTaxonomy.join(", ")}. Codex will take them, but
                  they will not line up with anything already in the knowledge base.
                </p>
              )}
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addTyped()}
                placeholder={data.taxonomy_loaded ? "Filter the vocabulary…" : "Type a tag…"}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {!typed && options.length > 0 && (
                  <span className="font-mono text-xs text-slate-600 self-center mr-0.5">
                    suggested
                  </span>
                )}
                {options.map((t) => (
                  <Chip key={t} onClick={() => toggle(t)} icon={Plus}>
                    {t}
                  </Chip>
                ))}
                {typed && !inTaxonomy.has(typed) && !tags.includes(typed) && (
                  <Chip tone="warn" onClick={addTyped} icon={Plus}>
                    {typed}
                  </Chip>
                )}
              </div>
            </div>

            {/* reflection */}
            <div>
              <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">
                Your reflection <span className="text-slate-600 normal-case">— optional</span>
              </p>
              <textarea
                rows={4}
                value={reflection}
                onChange={(e) => setReflection(e.target.value)}
                placeholder="What this changes for you, and what would change your mind…"
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 resize-none"
              />
              <p className="text-xs text-slate-500 leading-relaxed mt-1.5">
                Your words only — Sift never writes this field, and leaves it out entirely when
                blank. An absent reflection caps the fragment&rsquo;s completeness at 0.5 in Codex,
                which is disclosure, not a gate.
              </p>
            </div>

            {/* preview */}
            <div>
              <button
                onClick={() => setShowJson((v) => !v)}
                className="font-mono text-xs uppercase tracking-wide text-slate-500"
              >
                {showJson ? "Hide" : "Show"} fragment · {data.filename}
              </button>
              {showJson && (
                <pre className="mt-2 rounded-lg bg-slate-900 border border-slate-800 p-3 text-[11px] leading-relaxed text-slate-400 overflow-x-auto">
                  {preview}
                </pre>
              )}
              <p className="text-xs text-slate-500 leading-relaxed mt-2">
                Import it with{" "}
                <span className="font-mono text-slate-400">codex import {data.filename}</span>. The
                id is fixed, so a second import of the same note fails loudly instead of
                duplicating.
              </p>
            </div>
          </div>

          <div className="px-5 pb-8 pt-2 flex flex-col gap-2 border-t border-slate-800">
            <button
              onClick={doDownload}
              disabled={busy}
              className="w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-3.5 inline-flex items-center justify-center gap-2 active:bg-teal-400 disabled:opacity-50"
            >
              <Download size={16} /> {busy ? "Saving…" : `Download ${data.filename}`}
            </button>
            <button
              onClick={doCopy}
              disabled={busy}
              className="w-full rounded-xl border border-slate-700 text-slate-300 py-3 inline-flex items-center justify-center gap-2 active:bg-slate-900 disabled:opacity-50"
            >
              {copied === "ok" ? (
                <>
                  <CheckCheck size={16} className="text-emerald-500" /> Copied
                </>
              ) : copied === "fail" ? (
                "Copy failed — open the preview and select it"
              ) : (
                <>
                  <Copy size={16} /> Copy JSON
                </>
              )}
            </button>
            {result && (
              <p className="text-xs text-emerald-500 text-center inline-flex items-center justify-center gap-1.5">
                <Check size={13} /> Reviewed and stamped — re-exporting gives the same fragment.
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
