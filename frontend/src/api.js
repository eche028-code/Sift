// Same-origin API client with an offline queue for swipe decisions.

class ApiError extends Error {
  constructor(message, status, offline = false) {
    super(message);
    this.status = status;
    this.offline = offline;
  }
}

async function req(method, path, body) {
  let r;
  try {
    r = await fetch(path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("You're offline — the server can't be reached.", 0, true);
  }
  if (!r.ok) {
    let detail = `Request failed (${r.status})`;
    try {
      const j = await r.json();
      if (j.detail) detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch { /* keep default */ }
    throw new ApiError(detail, r.status);
  }
  if (r.status === 204) return null;
  return r.json();
}

// ── offline queue for decisions/undo ─────────────────────────
const QKEY = "sift-queue";
const qload = () => {
  try {
    return JSON.parse(localStorage.getItem(QKEY)) || [];
  } catch {
    return [];
  }
};
const qsave = (q) => {
  try {
    localStorage.setItem(QKEY, JSON.stringify(q));
  } catch { /* private mode etc. */ }
  window.dispatchEvent(new Event("sift-queue"));
};

export const queueLength = () => qload().length;

let flushing = false;
export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    let q = qload();
    while (q.length > 0) {
      const op = q[0];
      try {
        if (op.t === "decision") {
          await req("POST", `/api/results/${op.sid}/${op.pid}/decision`, { status: op.status });
        } else {
          await req("POST", `/api/results/${op.sid}/${op.pid}/undo`);
        }
      } catch (e) {
        if (e.offline) return; // still offline — leave the queue alone
        // anything else (404 after a deleted search, …): drop the op, don't wedge the queue
      }
      q = q.slice(1);
      qsave(q);
    }
  } finally {
    flushing = false;
  }
}
window.addEventListener("online", flushQueue);

async function decide(searchId, paperId, status) {
  try {
    await req("POST", `/api/results/${searchId}/${paperId}/decision`, { status });
  } catch (e) {
    if (!e.offline) throw e;
    qsave([...qload(), { t: "decision", sid: searchId, pid: paperId, status }]);
  }
}

async function undoDecision(searchId, paperId) {
  const q = qload();
  const last = q[q.length - 1];
  if (last && last.t === "decision" && last.sid === searchId && last.pid === paperId) {
    qsave(q.slice(0, -1)); // decision never reached the server — just drop it
    return;
  }
  try {
    await req("POST", `/api/results/${searchId}/${paperId}/undo`);
  } catch (e) {
    if (!e.offline) throw e;
    qsave([...qload(), { t: "undo", sid: searchId, pid: paperId }]);
  }
}

export const api = {
  createSearch: (raw_query) => req("POST", "/api/searches", { raw_query }),
  listSearches: () => req("GET", "/api/searches"),
  getSearch: (id) => req("GET", `/api/searches/${id}`),
  patchSearch: (id, fields) => req("PATCH", `/api/searches/${id}`, fields),
  deleteSearch: (id) => req("DELETE", `/api/searches/${id}`),
  runSearch: (id) => req("POST", `/api/searches/${id}/run`),
  status: (id) => req("GET", `/api/searches/${id}/status`),
  deck: (id) => req("GET", `/api/searches/${id}/deck`),
  pool: (id) => req("GET", `/api/searches/${id}/pool`),
  synthesise: (id) => req("POST", `/api/searches/${id}/synthesise`),
  decide,
  undoDecision,
  listNotes: () => req("GET", "/api/notes"),
  getNote: (id) => req("GET", `/api/notes/${id}`),
  deleteNote: (id) => req("DELETE", `/api/notes/${id}`),
  listProviders: () => req("GET", "/api/providers"),
  addProvider: (p) => req("POST", "/api/providers", p),
  deleteProvider: (id) => req("DELETE", `/api/providers/${id}`),
  testProvider: (id, model) => req("POST", `/api/providers/${id}/test`, { model: model || null }),
  getSettings: () => req("GET", "/api/settings"),
  putSettings: (fields) => req("PUT", "/api/settings", fields),
  runCrawl: () => req("POST", "/api/crawl/run"),
  crawlLog: () => req("GET", "/api/crawl/log"),
};
