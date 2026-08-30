import { Trash2 } from "lucide-react";
import { api } from "../api";
import { Header, PaperFull } from "../components/bits";

export default function Detail({ go, searchId, paper: p }) {
  if (!p) {
    go("pool", { searchId });
    return null;
  }

  const remove = async () => {
    await api.decide(searchId, p.paper_id, "skipped").catch(() => {});
    go("pool", { searchId });
  };

  return (
    <>
      <Header onBack={() => go("pool", { searchId })} />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <PaperFull p={p} />
        <button
          onClick={remove}
          className="mt-5 w-full rounded-xl border border-rose-800 text-rose-400 py-3.5 inline-flex items-center justify-center gap-2 active:bg-rose-950"
        >
          <Trash2 size={16} /> Remove from pool
        </button>
      </div>
    </>
  );
}
