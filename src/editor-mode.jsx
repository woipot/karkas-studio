import React from "react";
import "./style.css";
import "./editor-mode.css";
import DesignerApp from "./designer-app.jsx";
import { EDITOR_STORAGE } from "./editor-bridge.js";

class EditorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Редактор остановлен:", error, info?.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="editor-crash" role="alert">
        <h1>Редактор не смог открыть проект</h1>
        <p>
          Сохранённый в браузере проект несовместим с текущей версией редактора или в редакторе произошла
          ошибка. Ваши данные не удалены.
        </p>
        <code>{String(this.state.error?.message ?? this.state.error)}</code>
        <div>
          <button
            onClick={() => {
              const raw = localStorage.getItem(EDITOR_STORAGE);
              if (raw) {
                const url = URL.createObjectURL(new Blob([raw], { type: "application/json" })),
                  a = document.createElement("a");
                a.href = url;
                a.download = "karkas-editor-backup.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }
            }}
          >
            Скачать резервную копию
          </button>
          <button
            onClick={() => {
              localStorage.removeItem(EDITOR_STORAGE);
              window.location.reload();
            }}
          >
            Начать с чистого проекта
          </button>
        </div>
      </div>
    );
  }
}

export default function EditorMode() {
  return (
    <EditorBoundary>
      <DesignerApp />
    </EditorBoundary>
  );
}
