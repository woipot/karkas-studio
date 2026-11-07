import React, { useEffect, useId, useState } from "react";
import { acquireMaterialTextures, materialFamily, textureMetres } from "./material-textures.js";
import {
  sheetMapData,
  sheetFormat,
  SHEETS_PER_PAGE,
  humanLabel,
  groupSheetStocks,
  sheetPieceGeometry,
} from "./materials-data.js";
const fmt = (n, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—";

export function SheetStock({ group, report, focus, textureImages = {} }) {
  const textureId = `surface-${useId().replaceAll(":", "")}`;
  const model = report.result.sheetModel,
    context = { project: report.project, model };
  const stock = group.stocks.find((s) => s.id === focus) ?? group.stocks[0];
  const [tileWidth, tileHeight] = textureMetres(materialFamily(stock.product));
  const hatch = `offcut-${group.id}`,
    waste = `waste-${group.id}`;
  const cutoutArea = stock.pieces.reduce((sum, p) => sum + sheetPieceGeometry(p).cutoutArea, 0);
  return (
    <article
      className={`engine-stock sheet-stock${group.stocks.some((s) => s.id === focus) ? " focused" : ""}`}
      id={`sheet-${stock.id}`}
    >
      <div className="engine-stock-head">
        <h3>
          {group.label} — ×{group.stocks.length}
          <small title={stock.id}>{humanLabel(stock, { ...context, type: "stock" })}</small>
        </h3>
        <span>{group.full ? "Листы используются целиком" : `Деталей на листе: ${stock.pieces.length}`}</span>
      </div>
      {stock.pieces.length > 0 && (
        <>
          <svg
            viewBox={`0 0 ${stock.width} ${stock.height}`}
            role="img"
            aria-label={`${group.label}: ${humanLabel(stock, { ...context, type: "stock" })}`}
            colorInterpolation="sRGB"
          >
            <defs>
              <pattern id={textureId} patternUnits="userSpaceOnUse" width={tileWidth} height={tileHeight}>
                <rect
                  width={tileWidth}
                  height={tileHeight}
                  fill={materialFamily(stock.product) === "osb3" ? "#c9a46a" : "#e9dcc0"}
                />
                {textureImages[materialFamily(stock.product)] && (
                  <image
                    href={textureImages[materialFamily(stock.product)]}
                    width={tileWidth}
                    height={tileHeight}
                    preserveAspectRatio="none"
                  />
                )}
              </pattern>
              <pattern
                id={hatch}
                patternUnits="userSpaceOnUse"
                width="0.04"
                height="0.04"
                patternTransform="rotate(45)"
              >
                <rect width="0.04" height="0.04" fill="#edf3e6" />
                <line x1="0" x2="0" y1="0" y2="0.04" stroke="#9aad89" strokeWidth="0.012" />
              </pattern>
              <pattern
                id={waste}
                patternUnits="userSpaceOnUse"
                width="0.04"
                height="0.04"
                patternTransform="rotate(-45)"
              >
                <rect width="0.04" height="0.04" fill="#f5eadb" />
                <line x1="0" x2="0" y1="0" y2="0.04" stroke="#c29370" strokeWidth="0.008" />
              </pattern>
            </defs>
            <rect width={stock.width} height={stock.height} fill={`url(#${waste})`} />
            {(stock.remnants ?? []).map((r, i) => (
              <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill={`url(#${hatch})`}>
                <title>
                  Пригодный остаток · {fmt(r.width * 1000, 0)} × {fmt(r.height * 1000, 0)} мм
                </title>
              </rect>
            ))}
            {stock.pieces.map((p, i) => {
              const geometry = sheetPieceGeometry(p),
                label = humanLabel(p, context);
              return (
                <g key={p.id}>
                  <rect x={p.x} y={p.y} width={p.width} height={p.height} fill={`url(#${waste})`}>
                    <title>Скосы и вырезы — отход обработки</title>
                  </rect>
                  {geometry.polygons.map((poly, j) => (
                    <polygon
                      key={j}
                      points={poly.map((q) => `${q.x},${q.y}`).join(" ")}
                      fill={`url(#${textureId})`}
                    />
                  ))}
                  {geometry.edges.map((edge, j) => (
                    <line
                      key={j}
                      x1={edge.a.x}
                      y1={edge.a.y}
                      x2={edge.b.x}
                      y2={edge.b.y}
                      stroke="#849771"
                      strokeWidth="0.002"
                    />
                  ))}
                  <title>
                    {label} · {fmt(p.sourceWidth * 1000, 0)} × {fmt(p.sourceHeight * 1000, 0)} мм
                    {p.rotated ? " · поворот 90°" : ""} · X {fmt(p.x * 1000, 0)}, Y {fmt(p.y * 1000, 0)} мм ·{" "}
                    {p.id}
                  </title>
                  {p.width > 0.25 && p.height > 0.12 && (
                    <g>
                      <rect
                        x={p.x + p.width * 0.05}
                        y={p.y + p.height / 2 - 0.035}
                        width={p.width * 0.9}
                        height="0.10"
                        rx="0.012"
                        fill="#fffdf2"
                        fillOpacity="0.85"
                      />
                      <text
                        x={p.x + p.width / 2}
                        y={p.y + p.height / 2}
                        textAnchor="middle"
                        fontSize={Math.min(0.032, p.width / Math.max(16, label.length * 0.65))}
                        fill="#465c39"
                      >
                        <tspan x={p.x + p.width / 2}>
                          {i + 1}. {label}
                          {p.rotated ? " ↻" : ""}
                        </tspan>
                        <tspan x={p.x + p.width / 2} dy="0.045">
                          {fmt(p.sourceWidth * 1000, 0)}×{fmt(p.sourceHeight * 1000, 0)}
                        </tspan>
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
            {(stock.cuts ?? []).map((r, i) => (
              <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} fill="#b8693a">
                <title>
                  Пропил · {fmt(r.width * 1000)} × {fmt(r.height * 1000)} мм
                </title>
              </rect>
            ))}
          </svg>
          {cutoutArea > 1e-7 && (
            <p className="engine-table-note">
              Скосы и вырезы деталей: {fmt(cutoutArea, 3)} м² отхода обработки, показаны коричневой
              штриховкой. Их пригодность для повторного использования не подтверждена.
            </p>
          )}
        </>
      )}
      <details open={group.full}>
        <summary>Куда идут листы · {group.stocks.length}</summary>
        <div className="sheet-destinations engine-table-card">
          <table>
            <thead>
              <tr>
                <th>Закупочный лист</th>
                <th>Место установки</th>
              </tr>
            </thead>
            <tbody>
              {group.stocks.map((s) => (
                <tr key={s.id}>
                  <td title={s.id}>{humanLabel(s, { ...context, type: "stock" })}</td>
                  <td>
                    {s.pieces.map((p) => (
                      <div key={p.id} title={p.id}>
                        {humanLabel(p, context)}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {!group.full && (
        <details>
          <summary>Детали, координаты и повороты показанного листа</summary>
          <div className="engine-table-card">
            <table>
              <thead>
                <tr>
                  <th>Деталь</th>
                  <th>Размер, мм</th>
                  <th>X / Y, мм</th>
                  <th>Поворот</th>
                </tr>
              </thead>
              <tbody>
                {stock.pieces.map((p, i) => (
                  <tr key={p.id}>
                    <td title={p.id}>
                      {i + 1}. {humanLabel(p, context)}
                    </td>
                    <td>
                      {fmt(p.sourceWidth * 1000, 0)} × {fmt(p.sourceHeight * 1000, 0)}
                    </td>
                    <td>
                      {fmt(p.x * 1000, 0)} / {fmt(p.y * 1000, 0)}
                    </td>
                    <td>{p.rotated ? "90°" : "Нет"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </article>
  );
}
export function SheetMaterials({ report }) {
  const model = report.result.sheetModel ?? {},
    data = sheetMapData(model),
    groups = groupSheetStocks(model);
  const [textureImages, setTextureImages] = useState({});
  useEffect(() => {
    const lease = acquireMaterialTextures();
    const families = [
      ...new Set((report.result.sheetModel?.cutting?.stocks ?? []).map((s) => materialFamily(s.product))),
    ];
    setTextureImages(
      Object.fromEntries(families.map((family) => [family, lease.cache.getPatternImage(family)])),
    );
    return () => lease.release();
  }, [report]);
  const focus = new URLSearchParams(window.location.search).get("sheet");
  const focusIndex = groups.findIndex((g) => g.stocks.some((s) => s.id === focus));
  const [page, setPage] = useState(() =>
    focusIndex >= 0 ? Math.floor(focusIndex / SHEETS_PER_PAGE) + 1 : 1,
  );
  useEffect(() => {
    const target = focus
      ? `sheet-${focus}`
      : window.location.hash === "#sheet-cutting"
        ? "sheet-cutting"
        : null;
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [focus]);
  const pages = Math.max(1, Math.ceil(groups.length / SHEETS_PER_PAGE)),
    current = Math.min(page, pages);
  const currency = report.estimate?.currency ?? report.project.prices?.currency ?? "RUB";
  const cost = (p) =>
    report.estimate?.rows?.find((r) => r.id === `sheet-${p.id}`)?.total ??
    (p.product === "legacy-wall-sheet"
      ? report.estimate?.rows?.find((r) => r.id === "structural-panels")?.total
      : null);
  return (
    <section className="materials-block" id="sheet-materials" aria-label="Листовые материалы">
      {report.project.sheathing?.walls && report.result.profiledBeam?.walls?.length > 0 && (
        <div className="engine-alert" role="status">
          Ядро wave 1 не строит листовую обшивку сплошных брусовых стен. Здесь учтены только фактически
          рассчитанные листы каркасных участков, пола и кровли. Крепление обшивки к усаживающемуся брусу не
          определено.
        </div>
      )}
      <h3>Листовые материалы</h3>
      {!model.purchases?.length ? (
        <p className="engine-empty">Каталоговые листы не заданы.</p>
      ) : (
        <div className="engine-table-card">
          <table>
            <thead>
              <tr>
                {[
                  "Материал",
                  "Формат, мм",
                  "Толщина, мм",
                  "Листов",
                  "Нетто, м²",
                  "Отход, %",
                  "Масса, кг",
                  `Стоимость, ${currency}`,
                ].map((t) => (
                  <th key={t}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.purchases.map((p) => (
                <tr key={p.id}>
                  <td>
                    {humanLabel(p, { type: "product" })}
                    <small>{p.product}</small>
                  </td>
                  <td>{sheetFormat(p.product, p.stocks?.[0]?.width, p.stocks?.[0]?.height)}</td>
                  <td>{p.thickness}</td>
                  <td>{p.count}</td>
                  <td>{fmt(p.area)}</td>
                  <td>{fmt(p.wastePercent)}</td>
                  <td>{fmt(p.mass)}</td>
                  <td>{fmt(cost(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="engine-table-note">
        Масса установленных панелей; закупка по общей карте. Отход не включает пригодные остатки. Цены
        иллюстративные, если не заданы проектом.
      </p>
      <h3>Альтернативы форматов</h3>
      {(model.formatSelections ?? []).length ? (
        model.formatSelections.map((g, i) => (
          <div key={i} className="materials-alternatives">
            <p>
              {humanLabel(g, { type: "product" })} · {g.thickness} мм · общий раскрой дома
            </p>
            <div className="engine-table-card">
              <table>
                <thead>
                  <tr>
                    <th>Формат, мм</th>
                    <th>Листов</th>
                    <th>Отход, %</th>
                    <th>Стоимость, {currency}</th>
                    <th>Выбор</th>
                  </tr>
                </thead>
                <tbody>
                  {g.alternatives.map((a) => (
                    <tr key={a.product} className={a.product === g.product ? "selected-format" : ""}>
                      <td>{sheetFormat(a.product)}</td>
                      <td>{a.count}</td>
                      <td>{fmt(a.wastePercent)}</td>
                      <td>{fmt(a.cost)}</td>
                      <td>
                        {a.product === g.product ? "✓ Выбран" : a.complete ? "Вариант" : "Неполный раскрой"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      ) : (
        <p className="engine-table-note">
          Формат задан явно либо сохранён прежний материал. Для сравнения выберите «Авто» в мастере.
        </p>
      )}
      <div id="sheet-cutting">
        <h3>Карта раскроя листов</h3>
        <p>
          Листов {data.count} при нижней границе {fmt(data.lowerBound, 0)}, отход {fmt(data.wastePercent)} %.{" "}
          {data.complete ? "" : "Карта неполная или отсутствует."}
        </p>
      </div>
      <p className="engine-table-note">
        Зелёная штриховка — пригодные остатки, коричневая — отход, сплошные коричневые линии — пропил,
        текстура — установленные детали, ↻ — поворот. Внутренние линии триангуляции скрыты. Размеры в мм.
        Эвристика не доказывает оптимум.
      </p>
      {groups.slice((current - 1) * SHEETS_PER_PAGE, current * SHEETS_PER_PAGE).map((group) => (
        <SheetStock
          key={group.id}
          group={group}
          report={report}
          focus={focus}
          textureImages={textureImages}
        />
      ))}
      {!!data.stocks.length && (
        <div className="engine-pager">
          <span>
            Схемы {(current - 1) * SHEETS_PER_PAGE + 1}–{Math.min(current * SHEETS_PER_PAGE, groups.length)}{" "}
            из {groups.length}
          </span>
          <div>
            <button disabled={current === 1} onClick={() => setPage(current - 1)}>
              Назад
            </button>
            <span>
              {current} / {pages}
            </span>
            <button disabled={current === pages} onClick={() => setPage(current + 1)}>
              Далее
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function ProfiledBeamMaterials({ report }) {
  const model = report.result.profiledBeam;
  if (!model?.walls?.length) return null;
  const casings = report.result.timber.instances.filter((b) => b.role === "beamCasing");
  return (
    <section className="materials-block" id="profiled-beam">
      <h3>Профилированный брус</h3>
      <p>
        Чистый объём {fmt(model.volume, 3)} м³ · масса {fmt(model.mass)} кг · джут {fmt(model.juteLength)}{" "}
        м.п. · нагели {model.dowels?.length ?? model.dowelCount} шт. · обсада {casings.length} деталей (
        {fmt(
          casings.reduce((s, b) => s + b.volume, 0),
          3,
        )}{" "}
        м³)
      </p>
      <div className="engine-table-card">
        <table>
          <thead>
            <tr>
              <th>Стена</th>
              <th>Этаж</th>
              <th>Венцов</th>
              <th>Джут, м.п.</th>
              <th>Нагелей, шт.</th>
              <th>Усадка, мм*</th>
              <th>Обсада, деталей</th>
            </tr>
          </thead>
          <tbody>
            {model.walls.map((w) => (
              <tr key={`${w.wallId}-${w.level}`}>
                <td title={w.wallId}>{humanLabel(w, { type: "wall", project: report.project })}</td>
                <td>{w.level}</td>
                <td>{w.courseCount}</td>
                <td>{fmt(w.juteLength)}</td>
                <td>{model.dowels.filter((d) => d.wallId === w.wallId && d.level === w.level).length}</td>
                <td>{fmt(w.settlementMM)}</td>
                <td>{casings.filter((b) => b.wallId === w.wallId && b.level === w.level).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="engine-table-note">
        * Усадка — допущение модели по влажности. Рабочая высота профиля, нагели, углы и скользящие примыкания
        требуют подтверждения.
      </p>
    </section>
  );
}
