import React from "react";
import Icon from "./icons.jsx";
import CornerDiagram, { cornerTypes } from "./nodes.jsx";
const n = (v, d = 2) => Number(v).toLocaleString("ru-RU", { maximumFractionDigits: d });
function Item({ label, value, unit }) {
  return (
    <div className="engineering-stat">
      <span>{label}</span>
      <strong>
        {n(value)} <small>{unit}</small>
      </strong>
    </div>
  );
}
function MiniResult({ label, value, limit, unit }) {
  const u = value / limit;
  return (
    <div className={`mini-result ${u > 1 ? "fail" : ""}`}>
      <span>{label}</span>
      <strong>
        {n(value)}{" "}
        <small>
          / {n(limit)} {unit}
        </small>
      </strong>
      <div>
        <i style={{ width: Math.min(100, u * 100) + "%" }} />
      </div>
    </div>
  );
}
export default function Stability({ project: p, result: r, onField }) {
  const m = r.members;
  const t = r.timber;
  if (!m || !t) return null;
  return (
    <div className="engineering-dashboard">
      <div className="mass-banner">
        <div className="mass-icon">
          <Icon name="layers" size={29} />
        </div>
        <div>
          <span>СОБСТВЕННЫЙ ВЕС КАРКАСА</span>
          <strong>
            {n(t.mass, 0)} <small>кг</small>
          </strong>
          <p>Объём каждой доски × плотность {p.timberDensity} кг/м³</p>
        </div>
        <div className="mass-banner-right">
          <span>Учтён в нагрузках</span>
          <strong>+ {n(t.weight)} кН</strong>
          <small>{t.instances.length} досок в модели</small>
        </div>
      </div>
      <div className="engineering-grid">
        <article className="engineering-card">
          <div className="eng-card-head">
            <span>01 / СТОЙКА</span>
            <em>Сжатие · Эйлер</em>
          </div>
          <h2>Устойчивость стойки</h2>
          <div className="column-illustration">
            <svg viewBox="0 0 260 150">
              <defs>
                <marker id="forceArrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                  <path d="m0 0 5 2.5L0 5" fill="#a37b48" />
                </marker>
              </defs>
              <rect x="118" y="25" width="19" height="103" fill="#ddccaa" stroke="#b39a6b" />
              <path d="M127 25C169 61 169 94 127 128" stroke="#c29b6c" strokeDasharray="4 3" fill="none" />
              <path d="M127 1v17m0 133v-17" stroke="#a37b48" strokeWidth="2" markerEnd="url(#forceArrow)" />
              <path d="M82 25v103m-4-103h8m-8 103h8" stroke="#b6c4a4" />
              <text x="66" y="80" transform="rotate(-90 66 80)" textAnchor="middle">
                L = {n(p.height)} м
              </text>
              <path d="M137 77h51m-7-6 6 6-6 6" stroke="#88a164" strokeWidth="2" fill="none" />
              <text x="188" y="66" textAnchor="end">
                раскрепление
              </text>
            </svg>
            <div>
              <Item label="Сечение" value={p.studB} unit={`× ${p.wallThickness * 1000} мм`} />
              <Item label="Свободная длина" value={p.studRestraint} unit="м" />
            </div>
          </div>
          <p className="engineering-note">
            Проверяются напряжение сжатия, идеальная потеря устойчивости и упругое укорочение. Фактическое
            раскрепление должно быть обеспечено конструкцией.
          </p>
          <div className="engineering-values">
            <MiniResult label="Продольная сила N" value={m.stud.force} limit={m.stud.capacity} unit="кН" />
            <MiniResult
              label="Напряжение σ = N / A"
              value={m.stud.stress}
              limit={p.compressionDesign}
              unit="МПа"
            />
            <div className="area-line">
              <span>Идеальная сила Эйлера</span>
              <strong>{n(m.stud.euler)} кН</strong>
            </div>
            <div className="area-line">
              <span>Упругое укорочение</span>
              <strong>{n(m.stud.shortening, 3)} мм</strong>
            </div>
            <div className="area-line">
              <span>Предельная свободная длина*</span>
              <strong>{n(m.stud.maxUnbracedLength)} м</strong>
            </div>
            <p className="small-note">
              * Только из идеальной формулы Эйлера при данной силе и K. Эксцентриситет, дефекты и нормативная
              кривая устойчивости не учтены.
            </p>
          </div>
        </article>
        <article className="engineering-card">
          <div className="eng-card-head">
            <span>02 / УКOСИНЫ</span>
            <em>Растяжение · Жёсткость</em>
          </div>
          <h2>Поперечные связи</h2>
          <div className="brace-illustration">
            <svg viewBox="0 0 300 150">
              <rect x="57" y="18" width="167" height="112" fill="#f7f9f1" stroke="#8d9f7b" strokeWidth="5" />
              <path d="m60 126 161-104" stroke="#be9d6d" strokeWidth="7" />
              <path
                d="m60 22 161 104"
                stroke="#d3bd96"
                strokeWidth="5"
                strokeDasharray={p.bracing ? undefined : "6 5"}
                opacity={p.bracing ? 1 : 0.35}
              />
              <path
                d="M9 45h36m-6-5 6 5-6 5M9 65h36m-6-5 6 5-6 5M9 85h36m-6-5 6 5-6 5"
                stroke="#9eb17f"
                fill="none"
                strokeWidth="1.5"
              />
              <path d="M57 144h167" stroke="#b8c6a8" />
              <text x="140" y="143" textAnchor="middle">
                ячейка {n(Math.min(p.braceBay, p.length, p.width))} м
              </text>
              <text x="248" y="79" textAnchor="middle">
                {n((Math.atan(p.height / Math.min(p.braceBay, p.length, p.width)) * 180) / Math.PI, 1)}°
              </text>
            </svg>
          </div>
          <p className="engineering-note">
            Х-связи в плоскости каждой стены. При смене ветра работает другая растянутая диагональ. Сжатая
            диагональ проверяется отдельно; крепёж требует расчёта.
          </p>
          <div className="engineering-values">
            {!p.bracing ? (
              <div className="unverified">
                <strong>Укосины отключены</strong>Передача горизонтальной нагрузки не обеспечена этой моделью.
              </div>
            ) : (
              <>
                {m.bracing.tension && (
                  <>
                    <MiniResult
                      label="Растяжение диагонали"
                      value={m.bracing.tension.force}
                      limit={m.bracing.tension.tensionCapacity}
                      unit="кН"
                    />
                    <div className="area-line">
                      <span>Упругое удлинение ΔL</span>
                      <strong>{n(m.bracing.tension.extension, 3)} мм</strong>
                    </div>
                    <div className="area-line">
                      <span>Перекос ячейки · только доски</span>
                      <strong>{n(m.bracing.tension.drift, 3)} мм</strong>
                    </div>
                  </>
                )}
                {m.bracing.compression && (
                  <>
                    <MiniResult
                      label="Сжатая диагональ · Эйлер"
                      value={m.bracing.compression.force}
                      limit={m.bracing.compression.compressionCapacity}
                      unit="кН"
                    />
                    <p className="small-note">
                      Сжатая диагональ не включается в основную работу Х-связи; показан риск её потери
                      устойчивости.
                    </p>
                  </>
                )}
                {m.bracing.missing?.length > 0 && (
                  <div className="unverified">
                    <strong>Не хватает свободного простенка</strong>
                    {m.bracing.missing.map((b, i) => (
                      <div key={i}>
                        {{ north: "Северная", south: "Южная", west: "Западная", east: "Восточная" }[b.wall]} ·{" "}
                        {b.floor} этаж
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </article>
      </div>
      <article className="engineering-card rafter-card">
        <div className="eng-card-head">
          <span>03 / СТРОПИЛО</span>
          <em>Изгиб · Прогиб</em>
        </div>
        <h2>Сечение и длина ската</h2>
        <div className="engineering-grid compact">
          <div>
            <MiniResult
              label="Напряжение изгиба"
              value={m.rafter.stress}
              limit={p.bendingDesign}
              unit="МПа"
            />
            <MiniResult
              label="Мгновенный прогиб"
              value={m.rafter.deflection}
              limit={m.rafter.deflectionAllowed}
              unit="мм"
            />
          </div>
          <div>
            <Item label="Длина стропильной доски" value={m.rafter.length} unit="м" />
            <Item label="Сечение" value={p.rafterB} unit={`× ${p.rafterH} мм`} />
            <p className="engineering-note">{m.rafter.note}</p>
          </div>
        </div>
        <div className="unverified">
          <strong>Боковая устойчивость требует отдельной проверки</strong>
          {m.lateral.note} Заданное раскрепление {n(p.lateralRestraint)} м.
        </div>
      </article>
      <article className="engineering-card corner-card">
        <div className="eng-card-head">
          <span>04 / УГЛОВОЙ ПАКЕТ</span>
          <em>Типовые схемы · условная геометрия</em>
        </div>
        <div className="corner-layout">
          <div>
            <h2>Узел начинается с геометрии</h2>
            <p className="engineering-note">
              Выберите состав угла. Количество досок и их масса обновятся в модели. Совместная работа досок и
              крепёж пакета не подтверждены.
            </p>
            <div className="corner-options">
              {cornerTypes.map((c) => (
                <button
                  className={p.cornerType === c.id ? "active" : ""}
                  key={c.id}
                  onClick={() => onField("cornerType", c.id)}
                >
                  <span>{c.boards} доски</span>
                  <strong>{c.label}</strong>
                </button>
              ))}
            </div>
          </div>
          <CornerDiagram type={p.cornerType} b={p.studB} h={p.wallThickness * 1000} />
        </div>
      </article>
      <div className="notice">
        <Icon name="info" size={18} />
        <p>
          Идеальная формула Эйлера не заменяет расчёт деревянной стойки по нормам. Расчёт изгиба и прогиба не
          подтверждает боковую устойчивость балки. Несущая способность крепежа и жёсткость всего дома здесь не
          определены.
        </p>
      </div>
    </div>
  );
}
