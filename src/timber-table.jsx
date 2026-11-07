import React, { useState, useMemo } from "react";
import Icon from "./icons.jsx";
const fmt = (v, d = 2) => Number(v).toLocaleString("ru-RU", { maximumFractionDigits: d });
const categoryNames = {
  foundation: "Пакетный ростверк",
  objects: "Отдельные объекты",
  walls: "Стены",
  floor: "Перекрытия",
  roof: "Кровля",
  bracing: "Укосины",
};
export default function TimberTable({ timber, onSelect, onExport }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(80);
  const schedules = useMemo(() => Object.fromEntries(timber.schedule.map((s) => [s.id, s])), [timber]);
  const rows = timber.instances.filter((i) => {
    const s = schedules[i.scheduleId];
    return (
      (category === "all" || i.category === category) &&
      `${i.id} ${i.name || s?.name || ""} ${i.role || ""}`.toLowerCase().includes(query.toLowerCase())
    );
  });
  return (
    <>
      <div className="table-heading">
        <div>
          <h2>Каждая доска в цифрах</h2>
          <p>
            {timber.instances.length} элементов · {fmt(timber.volume, 3)} м³ · {fmt(timber.mass, 0)} кг
          </p>
        </div>
        <button className="button secondary" onClick={onExport}>
          <Icon name="export" size={16} />
          Все доски CSV
        </button>
      </div>
      <div className="board-filters">
        <label className="board-search">
          <Icon name="cursor" size={14} />
          <input
            value={query}
            placeholder="Поиск доски по названию или ID"
            aria-label="Поиск доски"
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(80);
            }}
          />
        </label>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setLimit(80);
          }}
          aria-label="Категория досок"
        >
          <option value="all">Все конструкции</option>
          {Object.entries(categoryNames).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="table-scroll">
        <table className="board-table">
          <thead>
            <tr>
              <th>Доска / элемент</th>
              <th>Сечение</th>
              <th>Длина, м</th>
              <th>Масса, кг</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((i, k) => {
              const s = schedules[i.scheduleId];
              return (
                <tr
                  key={i.id}
                  onClick={() => onSelect({ type: "member", id: i.id })}
                  tabIndex="0"
                  role="button"
                  aria-label={`Доска ${i.id}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSelect({ type: "member", id: i.id });
                  }}
                >
                  <td>
                    <span className="board-id">{i.id}</span>
                    <span>
                      {i.name || s?.name || i.role || "Доска"}
                      <small>
                        {categoryNames[i.category] || i.category} · {i.floor ? `${i.floor} эт.` : ""}
                      </small>
                    </span>
                  </td>
                  <td>{s?.section || `${fmt(i.b * 1000, 0)} × ${fmt(i.h * 1000, 0)}`}</td>
                  <td className="quantity">{fmt(i.length, 3)}</td>
                  <td className="quantity">{fmt(i.mass, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <div className="empty-table">Доски по этому запросу не найдены</div>}
      </div>
      {rows.length > limit && (
        <button className="button secondary full mt" onClick={() => setLimit((v) => v + 100)}>
          Показать ещё · осталось {rows.length - limit}
        </button>
      )}
      <div className="notice">
        <Icon name="info" size={18} />
        <p>
          Масса = объём × заданная плотность. Таблица и 3D используют одни и те же элементы. Надрезы,
          отверстия под крепёж и технологический запас не вычитаются из массы.
        </p>
      </div>
    </>
  );
}
