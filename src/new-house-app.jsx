import React, { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./icons.jsx";
import { ReportSections, readReport, download } from "./engine-viewer.jsx";
import { runEngine } from "./engine-client.js";
import { loadSiteLoads } from "./optional-modules.js";
import { projectFileJSON, projectFileName, parseProjectFile } from "./project-file.js";
import { openInEditor, editorProject } from "./editor-bridge.js";
import {
  defaultWizardForm,
  validateWizardForm,
  footprintArea,
  budgetVerdict,
  readSiteLoads,
  roofShapes,
  footprintShapes,
  DEFAULT_SNOW,
  DEFAULT_WIND,
} from "./wizard-spec.js";
import "./engine-viewer.css";
import "./new-house.css";

const FORM_KEY = "karkas.wizard.form.v1",
  LAST_KEY = "karkas.wizard.last.v1";
const steps = [
  ["size", "home", "Размеры и контур"],
  ["floors", "layers", "Этажи и высота"],
  ["rooms", "table", "Комнаты"],
  ["site", "snow", "Город и нагрузки"],
  ["roof", "home", "Крыша"],
  ["budget", "weight", "Бюджет"],
];
const stepOfField = (field = "") =>
  /^rooms/.test(field)
    ? "rooms"
    : /^levels|secondLight/.test(field)
      ? "floors"
      : /^roof/.test(field)
        ? "roof"
        : /^loads/.test(field)
          ? "site"
          : "size";
const fmt = (n, d = 1) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—";
const rub = (n) => `${fmt(n, 0)} ₽`;

function readStored(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or private mode: the session still works, it just is not remembered.
  }
}

function NumberField({ label, value, onChange, unit, step = 0.1, min, max, hint, error }) {
  return (
    <label className={`nh-field ${error ? "invalid" : ""}`}>
      <span>{label}</span>
      <div>
        <input
          type="number"
          inputMode="decimal"
          value={value ?? ""}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
        {unit && <em>{unit}</em>}
      </div>
      {error ? <small className="nh-error-text">{error}</small> : hint && <small>{hint}</small>}
    </label>
  );
}

function Choice({ value, options, onChange, label }) {
  return (
    <div className="nh-choice" role="radiogroup" aria-label={label}>
      {options.map(([id, name, note]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          className={value === id ? "active" : ""}
          onClick={() => onChange(id)}
        >
          <strong>{name}</strong>
          {note && <small>{note}</small>}
        </button>
      ))}
    </div>
  );
}

function FootprintPreview({ form }) {
  const W = Number(form.width) || 0,
    D = Number(form.depth) || 0;
  if (W <= 0 || D <= 0) return null;
  const ww = Math.min(Number(form.wingWidth) || 0, W),
    wd = Math.min(Number(form.wingDepth) || 0, D);
  const pts =
    form.shape === "l-shape"
      ? [
          [0, 0],
          [W, 0],
          [W, wd],
          [ww, wd],
          [ww, D],
          [0, D],
        ]
      : [
          [0, 0],
          [W, 0],
          [W, D],
          [0, D],
        ];
  const s = 200 / Math.max(W, D),
    pad = 26;
  const ridge = form.roofShape !== "mono" && form.shape === "rectangle";
  return (
    <svg
      className="nh-preview"
      viewBox={`0 0 ${W * s + 2 * pad} ${D * s + 2 * pad}`}
      role="img"
      aria-label={`Контур ${fmt(W)} × ${fmt(D)} м`}
    >
      <polygon points={pts.map(([x, y]) => `${pad + x * s},${pad + y * s}`).join(" ")} />
      {ridge &&
        ((form.ridgeAxis === "auto" ? (D > W ? "y" : "x") : form.ridgeAxis) === "y" ? (
          <line x1={pad + (W * s) / 2} y1={pad} x2={pad + (W * s) / 2} y2={pad + D * s} className="ridge" />
        ) : (
          <line x1={pad} y1={pad + (D * s) / 2} x2={pad + W * s} y2={pad + (D * s) / 2} className="ridge" />
        ))}
      <text x={pad + (W * s) / 2} y={pad - 9} textAnchor="middle">
        {fmt(W, 2)} м
      </text>
      <text
        x={pad - 9}
        y={pad + (D * s) / 2}
        textAnchor="middle"
        transform={`rotate(-90 ${pad - 9} ${pad + (D * s) / 2})`}
      >
        {fmt(D, 2)} м
      </text>
    </svg>
  );
}

function Wizard({ form, setForm, onRun, siteLoads, busy, lastSaved, onRestore }) {
  const [step, setStep] = useState("size");
  const [cityState, setCityState] = useState({ status: "idle", message: "" });
  const { errors, warnings } = useMemo(() => validateWizardForm(form), [form]);
  const errorFor = (field) => errors.find((e) => e.field === field)?.message;
  const stepErrors = (id) => errors.filter((e) => e.step === id).length;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const index = steps.findIndex(([id]) => id === step);
  const area = footprintArea(form);
  async function lookupCity() {
    if (!siteLoads || !form.city.trim()) return;
    setCityState({ status: "loading", message: "" });
    try {
      const found = readSiteLoads(await siteLoads({ city: form.city.trim() }));
      if (!found) throw Error("Для этого города нагрузки не найдены — введите их вручную.");
      set({
        snow: found.snow ?? form.snow,
        wind: found.wind ?? form.wind,
        loadsSource: "city",
      });
      setCityState({
        status: "ok",
        message: [found.note, found.source].filter(Boolean).join(" · ") || "Нагрузки подставлены по городу.",
      });
    } catch (e) {
      setCityState({ status: "error", message: e?.message ?? "Не удалось определить нагрузки." });
    }
  }
  const roomsTotal = [1, 2].map((lv) =>
    form.rooms.filter((r) => (r.level ?? 1) === lv).reduce((s, r) => s + (Number(r.area) || 0), 0),
  );
  return (
    <main className="nh-wizard">
      <aside className="nh-steps" aria-label="Шаги мастера">
        <div className="engine-eyebrow">НОВЫЙ ДОМ · МАСТЕР</div>
        <h1>Опишите дом — движок посчитает каркас</h1>
        <ol>
          {steps.map(([id, icon, label], i) => (
            <li key={id}>
              <button
                className={`${step === id ? "active" : ""} ${stepErrors(id) ? "has-error" : ""}`}
                aria-current={step === id ? "step" : undefined}
                onClick={() => setStep(id)}
              >
                <i>{i + 1}</i>
                <span>{label}</span>
                {stepErrors(id) > 0 && <small>{stepErrors(id)}</small>}
              </button>
            </li>
          ))}
        </ol>
        <div className="nh-summary">
          <FootprintPreview form={form} />
          <div>
            <span>Площадь по осям</span>
            <strong>{fmt(area, 1)} м²</strong>
          </div>
          <div>
            <span>Этажей</span>
            <strong>{form.floors}</strong>
          </div>
          <div>
            <span>Крыша</span>
            <strong>
              {roofShapes.find(([id]) => id === form.roofShape)?.[1]} · {fmt(Number(form.pitch), 1)}°
            </strong>
          </div>
        </div>
        {lastSaved && (
          <button className="engine-button nh-restore" onClick={onRestore}>
            <Icon name="refresh" size={14} />
            Открыть последний расчёт
          </button>
        )}
      </aside>
      <section className="nh-card">
        {step === "size" && (
          <>
            <h2>Размеры и контур</h2>
            <p className="nh-lead">Размеры наружного контура задаются по осям стен, в метрах.</p>
            <label className={`nh-field wide ${errorFor("name") ? "invalid" : ""}`}>
              <span>Название проекта</span>
              <div>
                <input value={form.name} maxLength={160} onChange={(e) => set({ name: e.target.value })} />
              </div>
              {errorFor("name") && <small className="nh-error-text">{errorFor("name")}</small>}
            </label>
            <Choice
              label="Форма контура"
              value={form.shape}
              options={footprintShapes}
              onChange={(shape) => set({ shape })}
            />
            <div className="nh-grid">
              <NumberField
                label="Ширина (по X)"
                unit="м"
                value={form.width}
                onChange={(width) => set({ width })}
                min={2}
                max={60}
                error={errorFor("width")}
              />
              <NumberField
                label="Глубина (по Y)"
                unit="м"
                value={form.depth}
                onChange={(depth) => set({ depth })}
                min={2}
                max={60}
                error={errorFor("depth")}
              />
              {form.shape === "l-shape" && (
                <>
                  <NumberField
                    label="Ширина узкого крыла"
                    unit="м"
                    value={form.wingWidth}
                    onChange={(wingWidth) => set({ wingWidth })}
                    hint="Крыло идёт от левого края на всю глубину"
                    error={errorFor("wingWidth")}
                  />
                  <NumberField
                    label="Глубина широкой части"
                    unit="м"
                    value={form.wingDepth}
                    onChange={(wingDepth) => set({ wingDepth })}
                    hint="Правый дальний угол вырезается"
                    error={errorFor("wingDepth")}
                  />
                </>
              )}
            </div>
          </>
        )}
        {step === "floors" && (
          <>
            <h2>Этажи и высота</h2>
            <p className="nh-lead">
              Высота этажа — от верха перекрытия до верха стены. Поддерживаются 1 или 2 этажа.
            </p>
            <Choice
              label="Количество этажей"
              value={String(form.floors)}
              options={[
                ["1", "Один этаж"],
                ["2", "Два этажа", "Второй этаж по тому же контуру"],
              ]}
              onChange={(v) => set({ floors: Number(v) })}
            />
            <div className="nh-grid">
              {Array.from({ length: form.floors }, (_, i) => (
                <NumberField
                  key={i}
                  label={`Высота ${i + 1} этажа`}
                  unit="м"
                  value={form.heights[i]}
                  min={2}
                  max={5}
                  onChange={(h) => set({ heights: form.heights.map((x, j) => (j === i ? h : x)) })}
                  error={errorFor(`heights.${i}`)}
                />
              ))}
            </div>
          </>
        )}
        {step === "rooms" && (
          <>
            <h2>Комнаты</h2>
            <p className="nh-lead">
              Площадь — в чистоте между стенами. Движок сам расставит перегородки, коридор 1,2 м, двери и
              окна. Можно оставить список пустым — получится оболочка без перегородок.
            </p>
            <div className="nh-rooms">
              {form.rooms.map((r, i) => (
                <div className="nh-room" key={i}>
                  <input
                    aria-label={`Название комнаты ${i + 1}`}
                    className={errorFor(`rooms.${i}.name`) ? "invalid" : ""}
                    value={r.name}
                    placeholder="Название"
                    onChange={(e) =>
                      set({ rooms: form.rooms.map((q, j) => (j === i ? { ...q, name: e.target.value } : q)) })
                    }
                  />
                  <label>
                    <input
                      type="number"
                      aria-label={`Площадь комнаты ${i + 1}`}
                      className={errorFor(`rooms.${i}.area`) ? "invalid" : ""}
                      value={r.area}
                      step={0.5}
                      min={1}
                      onChange={(e) =>
                        set({
                          rooms: form.rooms.map((q, j) =>
                            j === i ? { ...q, area: e.target.value === "" ? "" : Number(e.target.value) } : q,
                          ),
                        })
                      }
                    />
                    <em>м²</em>
                  </label>
                  {form.floors === 2 && (
                    <select
                      aria-label={`Этаж комнаты ${i + 1}`}
                      value={r.level ?? 1}
                      onChange={(e) =>
                        set({
                          rooms: form.rooms.map((q, j) =>
                            j === i ? { ...q, level: Number(e.target.value) } : q,
                          ),
                        })
                      }
                    >
                      <option value={1}>1 этаж</option>
                      <option value={2}>2 этаж</option>
                    </select>
                  )}
                  <button
                    className="engine-icon-button"
                    aria-label={`Удалить комнату ${i + 1}`}
                    onClick={() => set({ rooms: form.rooms.filter((_, j) => j !== i) })}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
              <button
                className="engine-button"
                disabled={form.rooms.length >= 30}
                onClick={() => set({ rooms: [...form.rooms, { name: "", area: 10, level: 1 }] })}
              >
                <Icon name="plus" size={14} />
                Добавить комнату
              </button>
            </div>
            <p className="nh-note">
              Сумма: 1 этаж — {fmt(roomsTotal[0], 1)} м²
              {form.floors === 2 ? `, 2 этаж — ${fmt(roomsTotal[1], 1)} м²` : ""} при площади по осям{" "}
              {fmt(area, 1)} м² на этаж.
            </p>
            {errors
              .filter((e) => e.step === "rooms")
              .map((e) => (
                <p key={e.field} className="nh-error-text">
                  {e.message}
                </p>
              ))}
          </>
        )}
        {step === "site" && (
          <>
            <h2>Город и нагрузки</h2>
            <p className="nh-lead">
              Снег на грунте и давление ветра определяют сечения стропил, стоек и связей.
            </p>
            <label className="nh-field wide">
              <span>Город или населённый пункт</span>
              <div>
                <input
                  value={form.city}
                  placeholder="Например, Ногинск"
                  onChange={(e) => set({ city: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && lookupCity()}
                />
                {siteLoads && (
                  <button
                    className="engine-button"
                    disabled={!form.city.trim() || cityState.status === "loading"}
                    onClick={lookupCity}
                  >
                    {cityState.status === "loading" ? "Ищу…" : "Определить нагрузки"}
                  </button>
                )}
              </div>
              {cityState.message && (
                <small className={cityState.status === "error" ? "nh-error-text" : ""}>
                  {cityState.message}
                </small>
              )}
            </label>
            {!siteLoads && (
              <div className="nh-info">
                <Icon name="info" size={15} />
                <span>
                  Справочник нагрузок по городам не подключён в этой сборке. Укажите значения вручную по СП
                  20.13330 для вашего района или оставьте типовые ({fmt(DEFAULT_SNOW)} и {fmt(DEFAULT_WIND)}{" "}
                  кПа).
                </span>
              </div>
            )}
            <div className="nh-grid">
              <NumberField
                label="Снег на грунте"
                unit="кПа"
                step={0.05}
                value={form.snow}
                onChange={(snow) => set({ snow, loadsSource: "manual" })}
                error={errorFor("snow")}
                hint="Нормативный вес снегового покрова, кН/м²"
              />
              <NumberField
                label="Давление ветра"
                unit="кПа"
                step={0.01}
                value={form.wind}
                onChange={(wind) => set({ wind, loadsSource: "manual" })}
                error={errorFor("wind")}
                hint="Нормативное значение w₀, кН/м²"
              />
            </div>
            <p className="nh-note">
              Источник значений:{" "}
              {form.loadsSource === "city"
                ? "справочник по городу"
                : form.loadsSource === "manual"
                  ? "введены вручную"
                  : "типовые по умолчанию"}
              .
            </p>
          </>
        )}
        {step === "roof" && (
          <>
            <h2>Крыша</h2>
            <p className="nh-lead">Схему стропил или ферм движок подберёт сам по пролёту и нагрузкам.</p>
            <Choice
              label="Форма крыши"
              value={form.roofShape}
              options={roofShapes}
              onChange={(roofShape) => set({ roofShape })}
            />
            <div className="nh-grid">
              <NumberField
                label="Уклон"
                unit="°"
                step={1}
                min={2}
                max={60}
                value={form.pitch}
                onChange={(pitch) => set({ pitch })}
                error={errorFor("pitch")}
              />
              <label className="nh-field">
                <span>{form.roofShape === "mono" ? "Направление ската" : "Конёк"}</span>
                <div>
                  <select value={form.ridgeAxis} onChange={(e) => set({ ridgeAxis: e.target.value })}>
                    <option value="auto">авто — по длинной стороне</option>
                    <option value="x">вдоль ширины (X)</option>
                    <option value="y">вдоль глубины (Y)</option>
                  </select>
                </div>
              </label>
            </div>
          </>
        )}
        {step === "budget" && (
          <>
            <h2>Бюджет</h2>
            <p className="nh-lead">
              Необязательно. После расчёта смета каркаса будет сравнена с этой суммой. В смету входят
              пиломатериал, сваи, крепёж и плиты по прайсу движка — без отделки, инженерии и работ, если они
              не заданы в ценах.
            </p>
            <div className="nh-grid">
              <NumberField
                label="Бюджет на каркас"
                unit="₽"
                step={10000}
                min={0}
                value={form.budget ?? ""}
                onChange={(budget) => set({ budget: budget === "" ? null : budget })}
                error={errorFor("budget")}
              />
            </div>
          </>
        )}
        {warnings
          .filter((w) => w.step === step)
          .map((w, i) => (
            <div key={i} className="engine-alert">
              {w.message}
            </div>
          ))}
        <footer className="nh-card-footer">
          <button
            className="engine-button"
            disabled={index === 0}
            onClick={() => setStep(steps[index - 1][0])}
          >
            Назад
          </button>
          {errors.length > 0 && (
            <span className="nh-error-text">
              Исправьте: {errors[0].message}
              {errors.length > 1 ? ` (и ещё ${errors.length - 1})` : ""}
            </span>
          )}
          {index < steps.length - 1 && (
            <button className="engine-button" onClick={() => setStep(steps[index + 1][0])}>
              Далее
              <Icon name="arrow" size={14} />
            </button>
          )}
          <button className="engine-button nh-primary" disabled={errors.length > 0 || busy} onClick={onRun}>
            <Icon name="cube" size={15} />
            Рассчитать дом
          </button>
        </footer>
      </section>
    </main>
  );
}

function FixesPanel({ capabilities, current, run, onApplied }) {
  const [state, setState] = useState({ status: "idle", fixes: [], message: "" });
  const [applying, setApplying] = useState(null);
  useEffect(() => setState({ status: "idle", fixes: [], message: "" }), [current.report]);
  async function propose() {
    setState({ status: "loading", fixes: [], message: "" });
    try {
      const { fixes } = await run("proposeFixes", {
        project: current.report.project,
        report: current.report,
      });
      setState({ status: "ready", fixes, message: fixes.length ? "" : "Движок не нашёл, что исправить." });
    } catch (e) {
      setState({ status: "error", fixes: [], message: e.message });
    }
  }
  async function apply(fix) {
    setApplying(fix.id);
    try {
      const { report } = fix.project
        ? await run("evaluate", { project: fix.project, planning: current.planning })
        : await run("patch", {
            project: current.report.project,
            planning: current.planning,
            operations: fix.operations,
          });
      onApplied(report, `Применено: ${fix.title}`);
    } catch (e) {
      setState((s) => ({ ...s, message: `Не удалось применить «${fix.title}»: ${e.message}` }));
    } finally {
      setApplying(null);
    }
  }
  async function optimize() {
    setApplying("optimize");
    try {
      const { report, notes } = await run("optimize", {
        project: current.report.project,
        planning: current.planning,
      });
      onApplied(
        report,
        notes?.length ? `Оптимизация применена: ${notes.join(" → ")}.` : "Оптимизация применена.",
      );
    } catch (e) {
      setState((s) => ({ ...s, message: e.message }));
    } finally {
      setApplying(null);
    }
  }
  const failed = (current.report.result.checks ?? []).filter((c) => c.status === "fail");
  return (
    <section className="engine-report-section nh-fixes">
      <div className="engine-section-heading">
        <div>
          <div className="engine-eyebrow">ПОДБОР РЕШЕНИЙ</div>
          <h2>Предложить исправления</h2>
          <p>
            {failed.length
              ? `Превышений в проверках: ${failed.length}. Движок предложит изменения сечений, шага и схемы; каждое применяется отдельно с полным пересчётом.`
              : "Проверок с превышением нет. Можно поискать более экономичные решения."}
          </p>
        </div>
        <div className="nh-fix-actions">
          {capabilities.proposeFixes && (
            <button
              className="engine-button nh-primary"
              disabled={state.status === "loading" || !!applying}
              onClick={propose}
            >
              <Icon name="settings" size={15} />
              {state.status === "loading" ? "Подбираю…" : "Предложить исправления"}
            </button>
          )}
          {capabilities.optimize && (
            <button className="engine-button" disabled={!!applying} onClick={optimize}>
              <Icon name="weight" size={15} />
              {applying === "optimize" ? "Оптимизирую…" : "Оптимизировать"}
            </button>
          )}
        </div>
      </div>
      {state.message && <div className="engine-alert">{state.message}</div>}
      {state.fixes.length > 0 && (
        <div className="engine-check-list">
          {state.fixes.map((fix) => (
            <div className="nh-fix" key={fix.id}>
              <div>
                <strong>{fix.title}</strong>
                {fix.description && <p>{fix.description}</p>}
                <small>
                  {fix.operations
                    ? `${fix.operations.length} изменени${fix.operations.length === 1 ? "е" : "й"} проекта`
                    : "Новый вариант проекта"}
                  {fix.cost !== null ? ` · ${fix.cost > 0 ? "+" : ""}${rub(fix.cost)}` : ""}
                  {fix.checks.length ? ` · проверки: ${fix.checks.join(", ")}` : ""}
                </small>
              </div>
              <button className="engine-button" disabled={!!applying} onClick={() => apply(fix)}>
                {applying === fix.id ? "Пересчёт…" : "Применить"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ResultBanner({ current, form, notes, canUndo, onUndo }) {
  const s = current.report.summary ?? {},
    verdict = current.fromWizard ? budgetVerdict(form, current.report) : null;
  const warnings = [...(current.report.planning?.warnings ?? []), ...(current.notes ?? [])];
  const status =
    s.status === "failed_checks"
      ? [
          "fail",
          `Есть превышения: ${s.failedChecks}`,
          "Откройте «Проверки» — там указано, какие элементы не проходят.",
        ]
      : s.status === "incomplete"
        ? ["pending", "Расчёт неполный", "Часть геометрии или раскроя не определена — см. «Проверки»."]
        : [
            "pass",
            "Частные проверки в пределах",
            "Результат требует проверки инженером: движок не заменяет проект КР.",
          ];
  return (
    <div className="nh-banner">
      <div className={`nh-status ${status[0]}`}>
        <strong>{status[1]}</strong>
        <span>{status[2]}</span>
      </div>
      {verdict && (
        <div className={`nh-status ${verdict.over ? "fail" : "pass"}`}>
          <strong>
            Смета {rub(verdict.total)} {verdict.over ? "выше" : "в пределах"} бюджета {rub(verdict.budget)}
          </strong>
          <span>
            {verdict.over
              ? `Не хватает ${rub(verdict.delta)} (${fmt((verdict.ratio - 1) * 100, 0)} %). Уменьшите площадь, уклон или этажность.`
              : `Запас ${rub(-verdict.delta)}.`}
          </span>
        </div>
      )}
      {notes && <div className="nh-status info">{notes}</div>}
      {canUndo && (
        <button className="engine-button" onClick={onUndo}>
          <Icon name="undo" size={14} />
          Отменить последнее изменение
        </button>
      )}
      {warnings.length > 0 && (
        <details className="engine-alert nh-warnings">
          <summary>Замечания: {warnings.length}</summary>
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </details>
      )}
    </div>
  );
}

export default function NewHouseApp() {
  const [form, setForm] = useState(() => ({ ...defaultWizardForm(), ...(readStored(FORM_KEY) ?? {}) }));
  const [phase, setPhase] = useState("form");
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState("");
  const [siteLoads, setSiteLoads] = useState(null);
  const [capabilities, setCapabilities] = useState({ proposeFixes: false, optimize: false });
  const [lastSaved, setLastSaved] = useState(() => readStored(LAST_KEY));
  const file = useRef(null);
  const busy = phase === "running";

  useEffect(() => store(FORM_KEY, form), [form]);
  useEffect(() => {
    loadSiteLoads().then((fn) => setSiteLoads(() => fn));
    runEngine("capabilities")
      .then(setCapabilities)
      .catch(() => {});
    if (new URLSearchParams(window.location.search).get("from") === "editor") {
      window.history.replaceState(null, "", "/?mode=new");
      const project = editorProject();
      if (project) evaluateProject(project, {}, { label: "Проект из редактора" });
    }
  }, []);

  function show(report, meta = {}) {
    const checked = readReport(report);
    const next = {
      report: checked,
      planning: meta.planning ?? checked.sourcePlanning ?? {},
      fromWizard: !!meta.fromWizard,
      notes: meta.notes ?? [],
    };
    setCurrent(next);
    setPhase("result");
    setError(null);
    store(LAST_KEY, { project: checked.project, planning: next.planning, name: checked.project.name });
    setLastSaved({ project: checked.project, planning: next.planning, name: checked.project.name });
    window.scrollTo({ top: 0 });
  }
  function fail(e, origin) {
    const first = e?.errors?.[0];
    setError({
      message: e?.message ?? String(e),
      details: (e?.errors ?? []).map((x) => (typeof x === "string" ? x : (x.message ?? JSON.stringify(x)))),
      step: origin === "wizard" ? (first?.step ?? stepOfField(first?.field ?? first?.path)) : null,
    });
    setPhase("error");
  }
  async function runWizard() {
    setPhase("running");
    setNotes("");
    setHistory([]);
    try {
      const { report } = await runEngine("wizard", { form });
      const extra = validateWizardForm(form).warnings.map((w) => w.message);
      show(report, { fromWizard: true, notes: extra });
    } catch (e) {
      fail(e, "wizard");
    }
  }
  async function evaluateProject(project, planning, { label } = {}) {
    setPhase("running");
    setHistory([]);
    setNotes(label ?? "");
    try {
      const { report } = await runEngine("evaluate", { project, planning });
      show(report, { planning });
    } catch (e) {
      fail(e, "import");
    }
  }
  async function importFile(f) {
    if (!f) return;
    try {
      const parsed = parseProjectFile(await f.text());
      evaluateProject(parsed.project, parsed.planning, { label: `Загружен файл ${f.name}` });
    } catch (e) {
      fail(e, "import");
    }
  }
  function applied(report, message) {
    setHistory((h) => [...h.slice(-19), current]);
    show(report, { planning: current.planning, fromWizard: current.fromWizard });
    setNotes(message);
  }
  function undo() {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setCurrent(prev);
    setNotes("Изменение отменено.");
  }

  const p = current?.report.project;
  const fixesAvailable = capabilities.proposeFixes || capabilities.optimize;
  return (
    <div className="engine-viewer nh-app">
      <header className="engine-topbar">
        <div className="engine-brand">
          <svg width="30" height="32" viewBox="0 0 32 34" fill="none" aria-hidden="true">
            <path
              d="M4 29V11L16 4l12 7v18M4 11l12 7 12-7M16 18v15M4 29l12-7 12 7"
              stroke="currentColor"
              strokeWidth="1.8"
            />
          </svg>
          <div>
            КАРКАС <strong>ENGINE</strong>
            <small>НОВЫЙ ДОМ · РАСЧЁТ В БРАУЗЕРЕ</small>
          </div>
        </div>
        <div className="engine-project-title">
          {phase === "result" ? p.name : form.name || "Новый дом"}
          <small>
            {phase === "result"
              ? `Площадь ${fmt(current.report.summary?.area, 1)} м² · смета ${rub(current.report.estimate?.total)}`
              : "Заполните шаги и нажмите «Рассчитать дом»"}
          </small>
        </div>
        <div className="engine-top-actions">
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              importFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button className="engine-top-button" disabled={busy} onClick={() => file.current?.click()}>
            <Icon name="upload" size={15} />
            Открыть JSON
          </button>
          {phase === "result" && (
            <>
              <button
                className="engine-top-button"
                title="Файл совместим с MCP-инструментом karkas_import_project"
                onClick={() => download(projectFileName(p), projectFileJSON(p))}
              >
                <Icon name="save" size={15} />
                Скачать проект
              </button>
              <button
                className="engine-top-button"
                onClick={() =>
                  download(projectFileName(p, "report"), JSON.stringify(current.report, null, 2))
                }
              >
                <Icon name="file" size={15} />
                JSON отчёта
              </button>
              <button className="engine-top-button" onClick={() => openInEditor(p)}>
                <Icon name="cursor" size={15} />
                Открыть в редакторе
              </button>
            </>
          )}
          {phase !== "form" && (
            <button className="engine-top-button" disabled={busy} onClick={() => setPhase("form")}>
              <Icon name="settings" size={15} />
              Параметры дома
            </button>
          )}
        </div>
      </header>
      {phase === "form" && (
        <Wizard
          form={form}
          setForm={setForm}
          onRun={runWizard}
          siteLoads={siteLoads}
          busy={busy}
          lastSaved={lastSaved}
          onRestore={() =>
            evaluateProject(lastSaved.project, lastSaved.planning ?? {}, { label: "Последний расчёт" })
          }
        />
      )}
      {phase === "running" && (
        <main className="engine-start-screen">
          <div className="engine-loading-state" role="status">
            <div className="engine-loading-cube">
              <Icon name="cube" size={45} />
            </div>
            <h1>Считаю каркас</h1>
            <p>Стены, перекрытия, крыша, сваи, проверки сечений, раскрой досок по 6 м и смета.</p>
            <small>Расчёт идёт в отдельном потоке — страница не зависает. Обычно 1–5 секунд.</small>
            <div className="engine-loading-line" />
          </div>
        </main>
      )}
      {phase === "error" && (
        <main className="engine-start-screen">
          <div className="engine-error-state" role="alert">
            <Icon name="warning" size={38} />
            <h1>Не удалось построить дом</h1>
            <p>{error?.message}</p>
            {error?.details?.length > 1 && (
              <small>
                {error.details.slice(0, 6).map((d, i) => (
                  <span key={i} style={{ display: "block" }}>
                    {d}
                  </span>
                ))}
              </small>
            )}
            <button className="engine-button" onClick={() => setPhase("form")}>
              {error?.step
                ? `Исправить: ${steps.find(([id]) => id === error.step)?.[2] ?? "параметры"}`
                : "Вернуться к параметрам"}
            </button>
          </div>
        </main>
      )}
      {phase === "result" && current && (
        <>
          <ResultBanner
            current={current}
            form={form}
            notes={notes}
            canUndo={history.length > 0}
            onUndo={undo}
          />
          <ReportSections
            report={current.report}
            extraTabs={fixesAvailable ? [["fixes", "settings", "Исправления"]] : []}
            renderExtra={(tab) =>
              tab === "fixes" && (
                <FixesPanel
                  capabilities={capabilities}
                  current={current}
                  run={runEngine}
                  onApplied={applied}
                />
              )
            }
          />
          <footer className="engine-footer">
            <span>
              КАРКАС ENGINE {current.report.engine?.version} <i /> Расчёт выполнен в браузере, без сервера
            </span>
            <span>м · кН · МПа · кг</span>
            <span className="engine-hash">{current.report.engine?.hash?.slice(0, 16)}</span>
          </footer>
        </>
      )}
    </div>
  );
}
