// Web Worker: runs the calculation core off the UI thread.
// Protocol: postMessage({id, type, payload}) → {id, ok, result} | {id, ok:false, error}.
import { runEngineTask } from "./engine-tasks.js";

self.onmessage = async (event) => {
  const { id, type, payload } = event.data ?? {};
  try {
    const result = await runEngineTask(type, payload);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({
      id,
      ok: false,
      error: {
        name: e?.name ?? "Error",
        code: e?.code ?? null,
        message: e?.message ?? String(e),
        errors: e?.errors ?? (Array.isArray(e?.details) ? e.details : null),
      },
    });
  }
};
