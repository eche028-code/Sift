import { useState, useEffect, useMemo, useRef } from "react";
import {
  Eye, ArrowLeft, Check, X, Undo2, Layers, Sparkles, FileText,
  AlertTriangle, ChevronRight, Copy, CheckCheck, Trash2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Demo corpus — replaced by the PubMed/Crossref pipeline later.
// ─────────────────────────────────────────────────────────────
const PAPERS = [
  {
    id: "p1",
    title: "Two-year axial elongation in children randomised to orthokeratology or single-vision spectacles",
    authors: "Cho P, Tan Q, et al.",
    journal: "Ophthalmology",
    year: 2025,
    design: "RCT",
    n: 102,
    followup: "24 mo",
    finding: "Ortho-K slowed axial elongation by 46% vs spectacles over two years.",
    weakness: "Outcome assessors unmasked; 18% dropout concentrated in the control arm.",
    strengths: ["Randomised allocation with concealed sequence", "Axial length by IOLMaster, not refraction", "Pre-registered primary outcome"],
    score: 88,
    badges: { peer: true, random: true, masked: false },
    pdf: true,
    detail: "Children aged 8–11 with −1.00 to −4.00 D myopia were randomised to overnight orthokeratology or single-vision spectacles. Mean axial elongation was 0.19 mm in the OK arm versus 0.35 mm in controls at 24 months. Effect size was stable across baseline refraction strata. No microbial keratitis events were recorded.",
  },
  {
    id: "p2",
    title: "Combined 0.01% atropine and orthokeratology in fast-progressing myopes: a prospective cohort",
    authors: "Kinoshita N, et al.",
    journal: "Cont Lens Anterior Eye",
    year: 2024,
    design: "Cohort",
    n: 74,
    followup: "12 mo",
    finding: "Combination therapy cut elongation to 0.12 mm/yr vs 0.21 mm/yr with OK alone.",
    weakness: "No randomisation — parents self-selected into combination therapy.",
    strengths: ["Consecutive enrolment from two clinics", "Same topographer and biometer across sites"],
    score: 72,
    badges: { peer: true, random: false, masked: false },
    pdf: true,
    detail: "Fast progressors (>0.75 D/yr) already in OK lenses were offered adjunct 0.01% atropine. Elongation over 12 months was significantly lower in the combination group after adjusting for age and baseline AL. Rebound after cessation was not assessed.",
  },
  {
    id: "p3",
    title: "Defocus incorporated multiple segments spectacle lenses: six-year follow-up of the original trial cohort",
    authors: "Lam CSY, et al.",
    journal: "Br J Ophthalmol",
    year: 2024,
    design: "Cohort (RCT ext.)",
    n: 90,
    followup: "72 mo",
    finding: "Treatment effect sustained to six years with no rebound after continued wear.",
    weakness: "Original controls crossed over at year 2, so long-term comparison is historical.",
    strengths: ["Longest DIMS dataset available", "Low attrition after year 3"],
    score: 78,
    badges: { peer: true, random: true, masked: false },
    pdf: false,
    detail: "Participants from the original DIMS RCT were followed for six years. Annualised axial growth remained near physiological norms for age. Because the control arm crossed over to DIMS lenses at 24 months, later comparisons rely on modelled historical controls.",
  },
  {
    id: "p4",
    title: "Repeated low-level red-light therapy for myopia control: meta-analysis of eight randomised trials",
    authors: "Xiong R, He M, et al.",
    journal: "JAMA Ophthalmol",
    year: 2026,
    design: "Meta-analysis",
    n: 1102,
    followup: "6–24 mo",
    finding: "Pooled effect showed 0.26 mm less elongation per year, with axial shortening in a subset.",
    weakness: "High heterogeneity, mostly 12-month data, and unresolved retinal safety signals.",
    strengths: ["Pre-registered protocol (PROSPERO)", "GRADE certainty assessment included", "Funnel plot suggests limited publication bias"],
    score: 81,
    badges: { peer: true, random: true, masked: true },
    pdf: true,
    detail: "Eight RCTs of 650 nm repeated low-level red-light therapy were pooled. The effect on axial length was the largest of any current modality, but I² was 74%, follow-up rarely exceeded 12 months, and two case reports of retinal disruption post-date most included trials. The authors call for OCT-based safety monitoring in any clinical use.",
  },
  {
    id: "p5",
    title: "Corneal staining and adverse events in paediatric orthokeratology: a 10-year retrospective record review",
    authors: "Bullimore MA, et al.",
    journal: "Optom Vis Sci",
    year: 2022,
    design: "Retrospective",
    n: 412,
    followup: "10 yr records",
    finding: "Significant staining in 6.3% of visits; no cases of microbial keratitis in 1,872 patient-years.",
    weakness: "Single-site records; mild events likely under-documented.",
    strengths: ["Large patient-year denominator", "Standardised grading in clinic protocol"],
    score: 55,
    badges: { peer: true, random: false, masked: false },
    pdf: false,
    detail: "Records of 412 paediatric OK wearers across a decade were reviewed for slit-lamp findings and adverse events. Staining was mostly grade 1 and transient. The absence of MK events is reassuring but reflects one specialty clinic's hygiene protocol rather than community practice.",
  },
  {
    id: "p6",
    title: "Early choroidal thickening predicts 12-month axial control in orthokeratology",
    authors: "Li Z, Chen Y, et al.",
    journal: "Invest Ophthalmol Vis Sci",
    year: 2025,
    design: "Prospective",
    n: 60,
    followup: "12 mo",
    finding: "One-month subfoveal choroidal thickening predicted good responders (AUC 0.79).",
    weakness: "Small sample and choroidal measurement variability near the reported effect size.",
    strengths: ["Masked OCT grading", "Pre-specified responder definition"],
    score: 64,
    badges: { peer: true, random: false, masked: true },
    pdf: true,
    detail: "Sixty new OK wearers underwent swept-source OCT at baseline, 1 month and 12 months. Children whose choroid thickened ≥20 µm at one month showed roughly half the axial growth of non-thickeners. Promising as an early triage marker, but confidence intervals are wide.",
  },
  {
    id: "p7",
    title: "Parental attitudes to myopia control interventions: an online cross-sectional survey",
    authors: "Nguyen T, et al.",
    journal: "Clin Exp Optom",
    year: 2023,
    design: "Survey",
    n: 530,
    followup: "—",
    finding: "Cost and infection fears were the leading barriers to starting ortho-K.",
    weakness: "Self-selected online sample; responses skew to engaged, higher-income parents.",
    strengths: ["Multinational recruitment", "Validated questionnaire items"],
    score: 42,
    badges: { peer: true, random: false, masked: false },
    pdf: false,
    detail: "An online survey distributed through clinic mailing lists and parenting forums explored awareness and willingness to pay for myopia interventions. Findings are useful for framing chair-side conversations but carry substantial selection bias.",
  },
  {
    id: "p8",
    title: "Low-concentration atropine dose–response and rebound: LAMP phase 3 extension",
    authors: "Yam JC, et al.",
    journal: "Ophthalmology",
    year: 2026,
    design: "RCT",
    n: 383,
    followup: "60 mo",
    finding: "0.05% atropine gave the best efficacy-to-rebound balance after cessation.",
    weakness: "Exclusively East Asian cohort limits generalisability to other populations.",
    strengths: ["Five-year randomised follow-up", "Washout phase isolates rebound", "Masked cycloplegic refraction"],
    score: 90,
    badges: { peer: true, random: true, masked: true },
    pdf: true,
    detail: "The LAMP extension followed children through treatment and a structured washout. Rebound was concentration-dependent and smallest with 0.05%. Axial-length benefit persisted one year after cessation in the 0.05% arm. The cohort remains a single-ancestry population, and applicability elsewhere is debated.",
  },
];

const RANGES = [
  { id: "1y", label: "1 yr", from: 2025 },
  { id: "5y", label: "5 yrs", from: 2021 },
  { id: "10y", label: "10 yrs", from: 2016 },
  { id: "all", label: "All", from: 0 },
];

const SAMPLES = [
  "Does ortho-k slow axial elongation in kids under 12?",
  "Rebound after stopping low-dose atropine",
  "Is red-light therapy safe for myopia control?",
];

const gradeOf = (s) =>
  s >= 85 ? { label: "Strong", bar: "bg-emerald-500", text: "text-emerald-700" }
  : s >= 70 ? { label: "Moderate", bar: "bg-teal-500", text: "text-teal-700" }
  : s >= 50 ? { label: "Limited", bar: "bg-amber-500", text: "text-amber-700" }
  : { label: "Weak", bar: "bg-rose-500", text: "text-rose-700" };

// ── small pieces ─────────────────────────────────────────────
const DesignChip = ({ children }) => (
  <span className="font-mono text-xs uppercase tracking-wide border border-stone-400 text-stone-700 rounded px-1.5 py-0.5">
    {children}
  </span>
);

const BadgeDot = ({ ok, children }) => (
  <span className={`inline-flex items-center gap-1 text-xs ${ok ? "text-stone-700" : "text-stone-400 line-through"}`}>
    {ok ? <Check size={12} className="text-emerald-600" /> : <X size={12} />}
    {children}
  </span>
);

const Meter = ({ score }) => {
  const g = gradeOf(score);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-mono text-xs uppercase tracking-wide text-stone-500">Evidence</span>
        <span className={`font-mono text-xs ${g.text}`}>{g.label} · {score}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-stone-200 overflow-hidden">
        <div className={`h-full rounded-full ${g.bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
};

// The paper card — cream stock on the dark reading-room ground.
const PaperCard = ({ p, stampKeep = 0, stampSkip = 0 }) => (
  <div className="relative h-full w-full rounded-2xl bg-amber-50 text-stone-900 shadow-2xl border border-amber-100 flex flex-col overflow-hidden select-none">
    {/* stamps */}
    <div
      className="absolute top-6 left-5 border-4 border-emerald-600 text-emerald-700 font-mono font-bold tracking-widest text-xl px-3 py-1 rounded rotate-12 z-10"
      style={{ opacity: stampKeep }}
    >
      ADD TO POOL
    </div>
    <div
      className="absolute top-6 right-5 border-4 border-rose-600 text-rose-700 font-mono font-bold tracking-widest text-xl px-3 py-1 rounded -rotate-12 z-10"
      style={{ opacity: stampSkip }}
    >
      SKIP
    </div>

    <div className="p-5 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2 flex-wrap">
        <DesignChip>{p.design}</DesignChip>
        <span className="font-mono text-xs text-stone-500">{p.year}</span>
        <span className="font-mono text-xs text-stone-500 truncate">{p.journal}</span>
        {p.pdf && (
          <span className="ml-auto inline-flex items-center gap-1 font-mono text-xs text-teal-700 border border-teal-600 rounded px-1.5 py-0.5">
            <FileText size={12} /> PDF
          </span>
        )}
      </div>

      <h2 className="font-serif text-xl leading-snug">{p.title}</h2>

      <p className="text-sm font-medium border-l-2 border-teal-600 pl-3 text-stone-800">
        {p.finding}
      </p>

      <p className="font-mono text-xs text-stone-500">
        n={p.n} · {p.followup} · {p.authors}
      </p>

      <div className="mt-auto flex flex-col gap-3">
        <Meter score={p.score} />
        <div className="flex gap-3 flex-wrap">
          <BadgeDot ok={p.badges.peer}>Peer-reviewed</BadgeDot>
          <BadgeDot ok={p.badges.random}>Randomised</BadgeDot>
          <BadgeDot ok={p.badges.masked}>Masked</BadgeDot>
        </div>
        <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-100 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {p.weakness}
        </p>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("search"); // search | filters | scanning | deck | pool | detail | note
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("5y");
  const [pdfOnly, setPdfOnly] = useState(false);

  const [deck, setDeck] = useState([]);
  const [kept, setKept] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [history, setHistory] = useState([]);
  const [detailId, setDetailId] = useState(null);

  const [scanStep, setScanStep] = useState(0);
  const [noteBusy, setNoteBusy] = useState(false);
  const [copied, setCopied] = useState("");

  // drag state
  const [drag, setDrag] = useState({ dx: 0, dy: 0, active: false });
  const [flying, setFlying] = useState(null); // 'left' | 'right'
  const start = useRef({ x: 0, y: 0 });

  const fromYear = RANGES.find((r) => r.id === range).from;
  const matches = useMemo(
    () => PAPERS.filter((p) => p.year >= fromYear && (!pdfOnly || p.pdf)),
    [fromYear, pdfOnly]
  );

  // scanning sequence
  const steps = [
    "Translating natural language → PubMed syntax",
    "Querying PubMed · Crossref · Europe PMC",
    "Screening 137 abstracts with triage model",
    `${matches.length} papers pass triage`,
  ];
  useEffect(() => {
    if (screen !== "scanning") return;
    if (scanStep >= steps.length) {
      const t = setTimeout(() => setScreen("deck"), 450);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setScanStep((s) => s + 1), 650);
    return () => clearTimeout(t);
  }, [screen, scanStep]); // eslint-disable-line

  const runSearch = () => {
    setDeck(matches);
    setKept([]); setSkipped([]); setHistory([]);
    setScanStep(0);
    setScreen("scanning");
  };

  const commit = (dir) => {
    setDeck((d) => {
      const [top, ...rest] = d;
      if (!top) return d;
      if (dir === "right") setKept((k) => [...k, top]);
      else setSkipped((s) => [...s, top]);
      setHistory((h) => [...h, { paper: top, dir }]);
      return rest;
    });
    setFlying(null);
    setDrag({ dx: 0, dy: 0, active: false });
  };

  const fly = (dir) => {
    if (flying || deck.length === 0) return;
    setFlying(dir);
    setTimeout(() => commit(dir), 280);
  };

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      if (last.dir === "right") setKept((k) => k.filter((p) => p.id !== last.paper.id));
      else setSkipped((s) => s.filter((p) => p.id !== last.paper.id));
      setDeck((d) => [last.paper, ...d]);
      return h.slice(0, -1);
    });
  };

  // pointer handlers (top card)
  const onDown = (e) => {
    if (flying) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setDrag({ dx: 0, dy: 0, active: true });
  };
  const onMove = (e) => {
    if (!drag.active || flying) return;
    setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y, active: true });
  };
  const onUp = () => {
    if (!drag.active || flying) return;
    if (drag.dx > 110) fly("right");
    else if (drag.dx < -110) fly("left");
    else setDrag({ dx: 0, dy: 0, active: false });
  };

  const topStyle = flying
    ? {
        transform: `translate(${flying === "right" ? 520 : -520}px, ${drag.dy}px) rotate(${flying === "right" ? 20 : -20}deg)`,
        opacity: 0,
        transition: "transform 300ms ease-out, opacity 300ms ease-out",
        touchAction: "none",
      }
    : drag.active
    ? {
        transform: `translate(${drag.dx}px, ${drag.dy * 0.15}px) rotate(${drag.dx * 0.06}deg)`,
        transition: "none",
        touchAction: "none",
      }
    : { transform: "none", transition: "transform 200ms ease-out", touchAction: "none" };

  const stampKeep = flying === "right" ? 1 : Math.min(1, Math.max(0, (drag.dx - 30) / 70));
  const stampSkip = flying === "left" ? 1 : Math.min(1, Math.max(0, (-drag.dx - 30) / 70));

  // synthesis note (assembled from what was actually kept)
  const note = useMemo(() => {
    if (kept.length === 0) return null;
    const bullets = kept.map((p) => ({
      label: `${p.authors.split(",")[0]} et al. (${p.year}, ${p.design}, n=${p.n})`,
      finding: p.finding,
      grade: gradeOf(p.score).label,
    }));
    const gaps = kept.map((p) => p.weakness.replace(/\.$/, "").toLowerCase());
    return {
      title: query.trim() ? `Evidence note — ${query.trim()}` : "Evidence note",
      intro: `Screened 137 abstracts; ${matches.length} passed triage; ${kept.length} kept after review.`,
      bullets,
      gaps: `Recurring limitations across the kept papers: ${gaps.join("; ")}.`,
      takeaway:
        "Across the retained studies, optical and pharmacological control show consistent axial-length benefit, with the strongest randomised evidence behind orthokeratology and 0.05% atropine. Newer modalities look promising but rest on shorter follow-up — treat their effect sizes as provisional and monitor safety signals.",
    };
  }, [kept, query, matches.length]);

  const noteText = note
    ? [
        note.title, "", note.intro, "",
        ...note.bullets.map((b) => `• ${b.label} — ${b.finding} [${b.grade}]`),
        "", note.gaps, "", "Clinical takeaway: " + note.takeaway,
      ].join("\n")
    : "";

  const copyNote = async () => {
    try {
      await navigator.clipboard.writeText(noteText);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(""), 1800);
  };

  const openNote = () => {
    setNoteBusy(true);
    setScreen("note");
    setTimeout(() => setNoteBusy(false), 1400);
  };

  const detail = detailId ? PAPERS.find((p) => p.id === detailId) : null;
  const seen = kept.length + skipped.length;
  const total = seen + deck.length;

  // ── shared chrome ──────────────────────────────────────────
  const Wordmark = ({ size = "text-2xl" }) => (
    <span className={`font-serif italic ${size} text-amber-50 inline-flex items-center gap-2`}>
      <Eye size={size === "text-2xl" ? 20 : 16} className="text-teal-400" />
      sift
    </span>
  );

  const Header = ({ onBack, right }) => (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
      <button onClick={onBack} className="p-2 -ml-2 text-slate-400 active:text-slate-200" aria-label="Back">
        <ArrowLeft size={20} />
      </button>
      <Wordmark size="text-lg" />
      <div className="w-16 flex justify-end">{right}</div>
    </div>
  );

  const PoolChip = () => (
    <button
      onClick={() => setScreen("pool")}
      className="inline-flex items-center gap-1.5 rounded-full border border-teal-500 text-teal-300 font-mono text-xs px-2.5 py-1 active:bg-teal-950"
    >
      <Layers size={13} /> {kept.length}
    </button>
  );

  // ── screens ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans flex justify-center">
      <div className="w-full max-w-md min-h-screen flex flex-col bg-slate-950">

        {screen === "search" && (
          <div className="flex-1 flex flex-col px-5 pt-16 pb-8 gap-6">
            <div>
              <Wordmark />
              <p className="text-sm text-slate-400 mt-2">
                AI-screened papers, one card at a time.
                <span className="font-mono text-xs text-slate-500 ml-2 border border-slate-700 rounded px-1.5 py-0.5">demo data</span>
              </p>
            </div>

            <div>
              <label className="font-mono text-xs uppercase tracking-wide text-slate-500">Ask in plain language</label>
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                rows={3}
                placeholder="e.g. Does ortho-k slow axial elongation in kids under 12?"
                className="mt-2 w-full rounded-xl bg-slate-900 border border-slate-700 focus:border-teal-500 focus:outline-none p-4 text-base text-slate-100 placeholder-slate-600 resize-none"
              />
            </div>

            <div className="flex flex-col gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="text-left text-sm text-slate-400 border border-slate-800 rounded-lg px-3 py-2 active:border-teal-600 active:text-teal-300"
                >
                  {s}
                </button>
              ))}
            </div>

            <button
              disabled={!query.trim()}
              onClick={() => setScreen("filters")}
              className="mt-auto w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-4 disabled:opacity-30 active:bg-teal-400 inline-flex items-center justify-center gap-2"
            >
              Screen the literature <ChevronRight size={18} />
            </button>
          </div>
        )}

        {screen === "filters" && (
          <>
            <Header onBack={() => setScreen("search")} />
            <div className="flex-1 flex flex-col px-5 py-6 gap-6">
              <div>
                <p className="font-serif text-lg text-amber-50 leading-snug">“{query.trim()}”</p>
                <p className="font-mono text-xs text-slate-500 mt-3 leading-relaxed">
                  <span className="text-teal-400">interpreted · simulated</span><br />
                  ("orthokeratology"[MeSH] OR "myopia control") AND ("axial length" OR "myopia, progression") AND (child* OR paediatric)
                </p>
              </div>

              <div>
                <label className="font-mono text-xs uppercase tracking-wide text-slate-500">Published within</label>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {RANGES.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRange(r.id)}
                      className={`rounded-lg py-2.5 text-sm border ${
                        range === r.id
                          ? "border-teal-500 bg-teal-950 text-teal-300"
                          : "border-slate-700 text-slate-400"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setPdfOnly((v) => !v)}
                className="flex items-center justify-between rounded-xl border border-slate-700 px-4 py-3.5"
              >
                <span className="text-sm text-slate-300 inline-flex items-center gap-2">
                  <FileText size={16} className="text-slate-500" /> Full text (PDF) only
                </span>
                <span className={`w-11 h-6 rounded-full p-0.5 transition-colors ${pdfOnly ? "bg-teal-500" : "bg-slate-700"}`}>
                  <span className={`block w-5 h-5 rounded-full bg-slate-950 transition-transform ${pdfOnly ? "translate-x-5" : ""}`} />
                </span>
              </button>

              <p className="font-mono text-xs text-slate-500">
                {matches.length} of {PAPERS.length} demo papers match
              </p>

              <button
                disabled={matches.length === 0}
                onClick={runSearch}
                className="mt-auto w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-4 disabled:opacity-30 active:bg-teal-400"
              >
                {matches.length === 0 ? "No matches — widen the range" : "Run search"}
              </button>
            </div>
          </>
        )}

        {screen === "scanning" && (
          <div className="flex-1 flex flex-col justify-center px-8 gap-4">
            {steps.map((s, i) => (
              <p key={s} className={`font-mono text-sm flex items-center gap-3 ${i < scanStep ? "text-slate-300" : i === scanStep ? "text-teal-300" : "text-slate-700"}`}>
                {i < scanStep ? <Check size={14} className="text-emerald-500 shrink-0" /> : <span className={`w-3.5 h-3.5 rounded-full border shrink-0 ${i === scanStep ? "border-teal-400 animate-pulse" : "border-slate-700"}`} />}
                {s}
              </p>
            ))}
          </div>
        )}

        {screen === "deck" && (
          <>
            <Header onBack={() => setScreen("search")} right={<PoolChip />} />
            <p className="text-center font-mono text-xs text-slate-500 pt-3">
              {deck.length > 0 ? `${seen + 1} of ${total}` : "deck cleared"}
            </p>

            <div className="flex-1 relative px-5 py-4 overflow-hidden">
              {deck.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-center px-6">
                  <p className="font-serif text-2xl text-amber-50">Deck cleared.</p>
                  <p className="text-sm text-slate-400">{kept.length} kept · {skipped.length} skipped</p>
                  <button onClick={() => setScreen("pool")} className="w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-3.5 active:bg-teal-400">
                    Review pool ({kept.length})
                  </button>
                  <button onClick={() => setScreen("search")} className="w-full rounded-xl border border-slate-700 text-slate-300 py-3.5">
                    New search
                  </button>
                </div>
              ) : (
                <div className="relative h-full">
                  {deck[2] && (
                    <div className="absolute inset-0 scale-90 translate-y-4 opacity-40">
                      <PaperCard p={deck[2]} />
                    </div>
                  )}
                  {deck[1] && (
                    <div className="absolute inset-0 scale-95 translate-y-2 opacity-70 transition-transform duration-200">
                      <PaperCard p={deck[1]} />
                    </div>
                  )}
                  <div
                    className="absolute inset-0 cursor-grab active:cursor-grabbing"
                    style={topStyle}
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                  >
                    <PaperCard p={deck[0]} stampKeep={stampKeep} stampSkip={stampSkip} />
                  </div>
                </div>
              )}
            </div>

            {deck.length > 0 && (
              <div className="flex items-center justify-center gap-8 pb-8 pt-2">
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
            {seen === 0 && deck.length > 0 && (
              <p className="text-center font-mono text-xs text-slate-600 pb-4 -mt-4">swipe right to keep · left to skip</p>
            )}
          </>
        )}

        {screen === "pool" && (
          <>
            <Header
              onBack={() => setScreen(deck.length > 0 ? "deck" : "search")}
              right={<span className="font-mono text-xs text-slate-500">{kept.length} kept</span>}
            />
            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
              {kept.length === 0 && (
                <p className="text-sm text-slate-500 text-center mt-16">
                  Nothing in the pool yet — swipe right on a card to keep it.
                </p>
              )}
              {kept.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setDetailId(p.id); setScreen("detail"); }}
                  className="text-left rounded-xl border border-slate-800 bg-slate-900 p-4 active:border-teal-600"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-mono text-xs uppercase text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">{p.design}</span>
                    <span className="font-mono text-xs text-slate-600">{p.year}</span>
                    <span className={`ml-auto font-mono text-xs ${gradeOf(p.score).text}`}>{p.score}</span>
                  </div>
                  <p className="font-serif text-amber-50 leading-snug">{p.title}</p>
                </button>
              ))}
            </div>
            {kept.length > 0 && (
              <div className="px-5 pb-8 pt-2">
                <button
                  onClick={openNote}
                  className="w-full rounded-xl bg-teal-500 text-slate-950 font-semibold py-4 inline-flex items-center justify-center gap-2 active:bg-teal-400"
                >
                  <Sparkles size={18} /> Synthesise {kept.length} paper{kept.length > 1 ? "s" : ""} into a note
                </button>
              </div>
            )}
          </>
        )}

        {screen === "detail" && detail && (
          <>
            <Header onBack={() => setScreen("pool")} />
            <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs uppercase text-slate-400 border border-slate-600 rounded px-1.5 py-0.5">{detail.design}</span>
                <span className="font-mono text-xs text-slate-500">{detail.year} · {detail.journal}</span>
                {detail.pdf && <span className="font-mono text-xs text-teal-400 inline-flex items-center gap-1"><FileText size={12} /> PDF</span>}
              </div>
              <h2 className="font-serif text-2xl text-amber-50 leading-snug">{detail.title}</h2>
              <p className="font-mono text-xs text-slate-500">n={detail.n} · {detail.followup} · {detail.authors}</p>

              <div className="rounded-xl bg-slate-900 border border-slate-800 p-4">
                <Meter score={detail.score} />
              </div>

              <p className="text-sm leading-relaxed text-slate-300">{detail.detail}</p>

              <div>
                <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">Strengths</p>
                {detail.strengths.map((s) => (
                  <p key={s} className="text-sm text-slate-300 flex gap-2 mb-1.5">
                    <Check size={14} className="text-emerald-500 shrink-0 mt-0.5" /> {s}
                  </p>
                ))}
              </div>
              <div>
                <p className="font-mono text-xs uppercase tracking-wide text-slate-500 mb-2">Flagged weakness</p>
                <p className="text-sm text-amber-400 flex gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {detail.weakness}
                </p>
              </div>

              <button
                onClick={() => { setKept((k) => k.filter((p) => p.id !== detail.id)); setScreen("pool"); }}
                className="mt-2 w-full rounded-xl border border-rose-800 text-rose-400 py-3.5 inline-flex items-center justify-center gap-2 active:bg-rose-950"
              >
                <Trash2 size={16} /> Remove from pool
              </button>
            </div>
          </>
        )}

        {screen === "note" && (
          <>
            <Header onBack={() => setScreen("pool")} />
            {noteBusy ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <Sparkles size={22} className="text-teal-400 animate-pulse" />
                <p className="font-mono text-sm text-slate-400">Synthesising {kept.length} papers…</p>
              </div>
            ) : note ? (
              <div className="flex-1 overflow-y-auto px-5 py-5">
                <div className="rounded-2xl bg-amber-50 text-stone-900 p-5 shadow-2xl">
                  <p className="font-mono text-xs text-stone-500 mb-2">Draft · generated from {kept.length} kept papers</p>
                  <h2 className="font-serif text-xl leading-snug mb-3">{note.title}</h2>
                  <p className="text-sm text-stone-600 mb-4">{note.intro}</p>
                  {note.bullets.map((b) => (
                    <div key={b.label} className="mb-3 pl-3 border-l-2 border-teal-600">
                      <p className="text-sm font-medium">{b.label}</p>
                      <p className="text-sm text-stone-700">{b.finding} <span className="font-mono text-xs text-stone-500">[{b.grade}]</span></p>
                    </div>
                  ))}
                  <p className="text-sm text-stone-700 mt-4"><span className="font-medium">Where the evidence is thin — </span>{note.gaps}</p>
                  <p className="text-sm text-stone-800 mt-4"><span className="font-medium">Clinical takeaway — </span>{note.takeaway}</p>
                </div>
                <button
                  onClick={copyNote}
                  className="mt-4 w-full rounded-xl border border-slate-700 text-slate-300 py-3.5 inline-flex items-center justify-center gap-2 active:bg-slate-900"
                >
                  {copied === "ok" ? <><CheckCheck size={16} className="text-emerald-500" /> Copied</> : copied === "fail" ? "Copy blocked in preview" : <><Copy size={16} /> Copy note</>}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
