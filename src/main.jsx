import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import ModeBar, { currentMode } from "./app-modes.jsx";

// Each mode is a separate chunk with its own stylesheet. Switching modes is a full
// page navigation (?mode=…), so the editor's global stylesheet never leaks into
// the report viewer and vice versa.
const EngineViewer = lazy(() => import("./engine-viewer.jsx"));
const NewHouseApp = lazy(() => import("./new-house-app.jsx"));
const EditorMode = lazy(() => import("./editor-mode.jsx"));

const mode = currentMode();
const Screen = mode === "new" ? NewHouseApp : mode === "editor" ? EditorMode : EngineViewer;
document.body.dataset.mode = mode;

createRoot(document.getElementById("root")).render(
  <>
    <ModeBar mode={mode} />
    <Suspense fallback={<div className="karkas-mode-loading">Загрузка…</div>}>
      <Screen />
    </Suspense>
  </>,
);
