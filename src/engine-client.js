// Main-thread client for src/engine-worker.js. Falls back to running the engine
// on the main thread (lazily imported) when Web Workers are unavailable.
let worker = null,
  seq = 0;
const pending = new Map();

function toError(e) {
  const err = new Error(e?.message ?? "Ошибка расчётного ядра.");
  err.name = e?.name ?? "Error";
  err.code = e?.code ?? null;
  err.errors = e?.errors ?? null;
  return err;
}

function getWorker() {
  if (worker || typeof Worker === "undefined") return worker;
  worker = new Worker(new URL("./engine-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data?.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.ok) job.resolve(data.result);
    else job.reject(toError(data.error));
  };
  worker.onerror = (event) => {
    const err = toError({ message: `Расчётный поток остановился: ${event.message ?? "ошибка загрузки"}` });
    for (const job of pending.values()) job.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function runEngine(type, payload) {
  const w = getWorker();
  if (!w)
    return import("./engine-tasks.js").then(
      (m) => m.runEngineTask(type, payload),
      (e) => Promise.reject(toError(e)),
    );
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, payload });
  });
}
