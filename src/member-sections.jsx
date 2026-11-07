import React, { useState } from "react";
import { SectionSelect } from "./estimate.jsx";

export default function MemberSections({ p, r, onChange }) {
  const [floor, setFloor] = useState(1);
  const walls = p.walls.filter((w) => (w.level ?? 1) === floor),
    sections = [...new Set(walls.map((w) => w.section))];
  const zones = p.roof.zones ?? r.roofModel?.zones ?? [];
  function field(group, key, value) {
    onChange((q) => ({ ...q, [group]: { ...q[group], [key]: value } }));
  }
  function roofZone(id, key, value) {
    onChange((q) => ({
      ...q,
      roof: {
        ...q.roof,
        zones: zones.map((z) => ({
          id: z.id,
          name: z.name,
          polygon: z.polygon,
          shape: z.shape,
          ridgeAngle: z.ridgeAngle,
          pitchLeft: z.pitchLeft,
          pitchRight: z.pitchRight,
          elevation: z.elevation ?? null,
          levelIndex: z.levelIndex,
          framing: z.framing ?? "auto",
          trussType: z.trussType,
          spacing: z.spacing,
          chordSection: z.chordSection,
          webSection: z.webSection,
          deflectionRatio: z.deflectionRatio ?? 300,
          ...(z.id === id ? { [key]: value } : {}),
        })),
      },
    }));
  }
  return (
    <section className="member-sections" aria-label="Сечения по конструкциям">
      <style>{`.member-sections{border:1px solid #dbe5cc;border-radius:8px;padding:20px;background:#f8fbf3;margin-bottom:25px}.member-sections h2{font-size:19px;margin:0;color:#728e53;font-weight:500}.member-sections>p{font-size:11px;line-height:1.7;color:#879b72}.member-section-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:18px}.member-section-grid>div{background:white;border:1px solid #e4ebdb;border-radius:6px;padding:13px}.member-section-grid small{display:block;color:#8d9e7d;line-height:1.6;font-size:10px;margin-top:7px}.member-section-grid select{max-width:100%}.member-section-floor{margin-top:14px;color:#7c9068;font-size:11px}.member-section-floor select{margin-left:10px;padding:5px;background:white;border:1px solid #dbe4cf;border-radius:4px}@media(max-width:650px){.member-section-grid{grid-template-columns:1fr}}`}</style>
      <h2>Какая доска где используется</h2>
      <p>
        Сечение задаётся отдельно для каждой конструкции. Изменения сразу обновляют 3D, вес, проверки, раскрой
        и смету. Длина закупочной доски — 6 м.
      </p>
      <label className="member-section-floor">
        Стены этажа
        <select
          aria-label="Этаж для сечений стен"
          value={floor}
          onChange={(e) => setFloor(Number(e.target.value))}
        >
          {p.levels.map((l) => (
            <option key={l.id} value={l.index}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <div className="member-section-grid">
        <div>
          <SectionSelect
            label="Сечение стен выбранного этажа"
            value={sections.length === 1 ? sections[0] : ""}
            onChange={(section) =>
              onChange((q) => ({
                ...q,
                walls: q.walls.map((w) => ((w.level ?? 1) === floor ? { ...w, section } : w)),
              }))
            }
          />
          <small>
            {sections.length > 1
              ? "На этаже разные сечения. Выбор заменит сечения всех его стен."
              : "Применяется ко всем стенам этого этажа. Отдельную стену можно изменить на плане."}{" "}
            Высокие стены в режиме «Авто» могут получить большее сечение по проверкам.
          </small>
        </div>
        <div>
          <SectionSelect
            label="Сечение лаг перекрытий"
            value={p.floor.section}
            onChange={(v) => field("floor", "section", v)}
          />
          <small>Лаги всех платформ; обрамление второго света задаётся отдельно.</small>
        </div>
        <div>
          <SectionSelect
            label="Доска пакетного ростверка"
            value={p.foundation.grillage.section}
            onChange={(section) =>
              onChange((q) => ({
                ...q,
                foundation: { ...q.foundation, grillage: { ...q.foundation.grillage, section } },
              }))
            }
          />
          <small>
            {p.foundation.grillage.plies} доски на ребро в одном пакете. Число слоёв и оголовки — в
            «Фундамент».
          </small>
        </div>
        <div>
          <SectionSelect
            label="Сечение врезных укосин"
            value={p.bracing.section}
            onChange={(v) => field("bracing", "section", v)}
          />
          <small>Используется при выборе врезных укосин в «Жёсткость».</small>
        </div>
        {zones.map((z) => (
          <React.Fragment key={z.id}>
            <div>
              <SectionSelect
                label={`${z.name} · стропила / пояса`}
                value={z.chordSection ?? p.roof.chordSection}
                onChange={(v) => roofZone(z.id, "chordSection", v)}
              />
              <small>
                Схема:{" "}
                {z.framing === "rafters"
                  ? "балки с заданным сечением"
                  : z.framing === "truss"
                    ? "фермы"
                    : "автоматический подбор"}
                .{" "}
                {r.roofModel?.zones?.find((q) => q.id === z.id)?.selectedSection &&
                  `Фактически: ${r.roofModel.zones.find((q) => q.id === z.id).selectedSection.replace("x", " × ")} мм.`}{" "}
                Чтобы сохранить именно заданную доску, выберите «Стропильные балки» в крыше.
              </small>
            </div>
            <div>
              <SectionSelect
                label={`${z.name} · решётка фермы`}
                value={z.webSection ?? p.roof.webSection}
                onChange={(v) => roofZone(z.id, "webSection", v)}
              />
              <small>
                Отдельное сечение раскосов и стоек фермы. При балочной схеме эти доски не создаются.
              </small>
            </div>
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}
