import { GearButton, Header, NavMenu } from "../components/bits";

const Step = ({ n, title, tag, tagTone = "teal", children }) => (
  <div className="flex gap-3">
    <span className="shrink-0 w-6 h-6 rounded-full border border-teal-600 text-teal-300 font-mono text-xs flex items-center justify-center mt-0.5">
      {n}
    </span>
    <div>
      <p className="text-sm font-medium text-slate-200">
        {title}
        {tag && (
          <span
            className={`ml-2 font-mono text-[11px] rounded-full border px-2 py-0.5 ${
              tagTone === "amber" ? "border-amber-700 text-amber-400" : "border-teal-800 text-teal-400"
            }`}
          >
            {tag}
          </span>
        )}
      </p>
      <p className="text-sm text-slate-400 mt-1 leading-relaxed">{children}</p>
    </div>
  </div>
);

export default function Help({ go }) {
  return (
    <>
      <Header
        menu={<NavMenu go={go} current="help" />}
        right={<GearButton onClick={() => go("settings")} />}
      />
      <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col gap-6">
        <div>
          <p className="font-serif text-xl text-amber-50 leading-snug">
            Ask a clinical question, swipe through the evidence.
          </p>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">
            Sift searches PubMed, has an AI read the abstracts for you, and deals the
            relevant papers as a deck of cards.
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <Step n={1} title="Ask">
            Type a question in plain language. The AI converts it into a PubMed
            query — review and edit the query before anything runs.
          </Step>
          <Step n={2} title="Fetch" tag="free">
            Pulls the newest matching records with abstracts straight from PubMed.
            No AI involved yet.
          </Step>
          <Step n={3} title="Preview & narrow" tag="free">
            Check what matched before spending tokens. If the list looks off,
            refine it with an instruction, or answer a couple of AI-suggested
            narrowing questions. Re-fetching is free — repeat as often as you like.
          </Step>
          <Step n={4} title="Screen" tag="spends tokens" tagTone="amber">
            The triage model reads every new abstract against your question,
            grades design, size and quality, and builds a ranked deck. Abstracts
            screened earlier are reused free.
          </Step>
          <Step n={5} title="Swipe">
            Right keeps a paper in your pool, left skips it, tap a card to read
            the full abstract. Your keeps and skips steer future screening.
          </Step>
          <Step n={6} title="Synthesise">
            Turn the pool into an evidence note — clinical takeaway first, then
            per-paper findings and where the evidence is thin. Copy it out from
            the note; every note lives in the Library.
          </Step>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex flex-col gap-2">
          <p className="font-mono text-xs uppercase tracking-wide text-slate-500">Good to know</p>
          <p className="text-sm text-slate-400 leading-relaxed">
            Everything runs on your own model key — pick a provider and model in
            Settings (the gear, top right).
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            Swipes made offline are queued and sync when the server is back in reach.
          </p>
          <p className="text-sm text-slate-400 leading-relaxed">
            Bookmark a topic to pin it under “Kept topics” on the Recent Search screen.
          </p>
        </div>
      </div>
    </>
  );
}
