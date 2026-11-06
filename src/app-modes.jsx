import React from "react";
import "./app-modes.css";

export const modes = [
  ["view", "Просмотр проекта", "Готовые расчёты из каталога MCP"],
  ["new", "Новый дом", "Мастер: размеры, этажи, комнаты, город, крыша"],
  ["editor", "Редактор", "Ручное рисование стен, проёмов и узлов"],
];

export function currentMode(search = typeof window === "undefined" ? "" : window.location.search) {
  const m = new URLSearchParams(search).get("mode");
  return modes.some(([id]) => id === m) ? m : "view";
}

export function modeHref(id) {
  return id === "view" ? "/" : `/?mode=${id}`;
}

export default function ModeBar({ mode }) {
  return (
    <nav className="karkas-modebar" aria-label="Режим работы">
      <span className="karkas-modebar-label">Режим</span>
      {modes.map(([id, label, hint]) => (
        <a
          key={id}
          href={modeHref(id)}
          className={id === mode ? "active" : ""}
          aria-current={id === mode ? "page" : undefined}
          title={hint}
        >
          {label}
        </a>
      ))}
      {mode === "editor" && (
        <a
          className="karkas-modebar-action"
          href="/?mode=new&from=editor"
          title="Отправить проект редактора в полное расчётное ядро: проверки, раскрой, смета, экспорт JSON для MCP"
        >
          Полный расчёт и экспорт →
        </a>
      )}
    </nav>
  );
}
