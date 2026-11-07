import React from "react";
import {
  beamProfiles,
  beamMoistures,
  beamCornerJoints,
  profiledBeamSections,
  beamDefaults,
} from "./profiled-beam-catalog.js";
import { sheetProducts } from "./sheet-catalog.js";
import { insulationProducts } from "./insulation.js";
import {
  wizardSheetChange,
  wizardSheetProducts,
  wizardWallSystemChange,
  wizardJoistSpacingChange,
} from "./wizard-spec.js";

function Select({ label, value, onChange, options }) {
  return (
    <label className="nh-field">
      <span>{label}</span>
      <div>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([id, text]) => (
            <option value={id} key={id}>
              {text}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}
export default function WizardMaterials({ form, set }) {
  const sheets = form.sheathing ?? {},
    insulation = form.insulation ?? {};
  function updateSheet(kind, patch) {
    const next = { ...sheets },
      value = wizardSheetChange(sheets[kind], patch, kind, form.joistSpacing);
    if (value) next[kind] = value;
    else delete next[kind];
    set({ sheathing: next });
  }
  function updateInsulation(kind, patch) {
    set({ insulation: { ...insulation, [kind]: { ...insulation[kind], ...patch } } });
  }
  return (
    <>
      <h2>Стены и обшивка</h2>
      <p className="nh-lead">
        Каталог задаёт ассортимент. Толщину и достаточность конструкции проверяйте по расчёту.
      </p>
      <div className="nh-grid">
        <Select
          label="Система стен"
          value={form.wallSystem ?? "frame"}
          onChange={(wallSystem) => set(wizardWallSystemChange(form, wallSystem))}
          options={[
            ["frame", "Каркас"],
            ["profiledBeam", "Профилированный брус"],
          ]}
        />
        {form.wallSystem === "profiledBeam" && (
          <>
            <Select
              label="Сечение бруса"
              value={form.beamSection ?? "145x145"}
              onChange={(beamSection) => set({ beamSection })}
              options={profiledBeamSections.map((s) => [s.id, s.label])}
            />
            {[
              ["beamProfile", "Профиль", beamProfiles, beamDefaults.profile],
              ["beamMoisture", "Влажность", beamMoistures, beamDefaults.moisture],
              ["beamCornerJoint", "Угловое соединение", beamCornerJoints, beamDefaults.cornerJoint],
            ].map(([key, label, choices, fallback]) => (
              <Select
                key={key}
                label={label}
                value={form[key] ?? fallback}
                onChange={(value) => set({ [key]: value })}
                options={Object.entries(choices)}
              />
            ))}
          </>
        )}
      </div>
      {form.wallSystem === "profiledBeam" && (
        <p className="nh-lead">
          145×145 мм, гребёнка, естественная влажность и тёплый угол — исходный пример, не нормативный подбор.
          Усадка и узлы требуют подтверждения поставщиком.
        </p>
      )}
      {[
        ["walls", "Обшивка стен"],
        ["floors", "Настил пола"],
        ["roof", "Сплошной настил кровли"],
      ].map(([kind, title]) => {
        const value = sheets[kind],
          material = sheetProducts.find((p) => p.id === value?.product)?.material ?? value?.product ?? "none";
        const products = wizardSheetProducts(material),
          catalog = products.find((p) => p.id === value?.product) ?? products[0];
        if (kind === "walls" && form.wallSystem === "profiledBeam")
          return (
            <fieldset className="nh-material-group" key={kind}>
              <legend>{title}</legend>
              <label className="nh-field">
                <span>Материал</span>
                <div>
                  <select value="none" disabled>
                    <option value="none">Нет · стены из бруса</option>
                  </select>
                </div>
              </label>
              <p className="nh-lead">
                Брус образует готовую стену и не обшивается листами. Отдельную отделку с учётом усадки
                проектируют отдельно.
              </p>
            </fieldset>
          );
        return (
          <fieldset className="nh-material-group" key={kind}>
            <legend>{title}</legend>
            <div className="nh-grid">
              <Select
                label="Материал"
                value={material}
                options={[
                  ["none", "Нет"],
                  ["osb3", "ОСП-3"],
                  ["plywood-fsf", "Фанера ФСФ"],
                ]}
                onChange={(material) => updateSheet(kind, { material })}
              />
              {value && (
                <>
                  <Select
                    label="Формат, мм"
                    value={value.product}
                    options={[
                      [material, "Авто · по стоимости раскроя"],
                      ...products.map((p) => [p.id, `${p.length * 1000} × ${p.width * 1000}`]),
                    ]}
                    onChange={(product) => updateSheet(kind, { product })}
                  />
                  <Select
                    label="Толщина, мм"
                    value={value.thickness}
                    options={catalog.thicknesses.map((t) => [t, t])}
                    onChange={(thickness) => updateSheet(kind, { thickness: Number(thickness) })}
                  />
                  {kind === "walls" && (
                    <Select
                      label="Сторона"
                      value={value.side}
                      options={[
                        ["exterior", "Снаружи"],
                        ["interior", "Изнутри"],
                        ["both", "Обе стороны"],
                      ]}
                      onChange={(side) => updateSheet(kind, { side })}
                    />
                  )}
                </>
              )}
            </div>
            {kind === "floors" && (
              <label className="nh-field">
                <span>Шаг лаг, мм</span>
                <div>
                  <input
                    type="number"
                    min="200"
                    max="1200"
                    step="100"
                    value={(form.joistSpacing ?? 0.6) * 1000}
                    onChange={(e) => set(wizardJoistSpacingChange(form, Number(e.target.value) / 1000))}
                  />
                </div>
                <small>
                  Для ОСП предлагается 22 мм при шаге 600 мм и 18 мм при 400 мм и меньше. Толщину можно
                  изменить.
                </small>
              </label>
            )}
            {kind === "roof" && (
              <p className="nh-lead">
                Сплошной настил нужен для мягкой/битумной черепицы. Для другой кровли уточните конструкцию у
                производителя покрытия.
              </p>
            )}
          </fieldset>
        );
      })}
      <p className="nh-lead">
        ОСП на стенах каркасного дома помогает сохранять его форму. Настил пола выбирается с учётом шага лаг.
        «Нет» отключает выбранную обшивку; для каркасных стен без ОСП потребуется другое решение раскрепления.
        Предложенные толщины — начальные значения, их нужно проверить по нагрузкам.
      </p>
      <h3>Утепление</h3>
      <p className="nh-lead">
        «По полости»: слои ограждения, если заданы, иначе глубина каркаса. Сплошные брусовые стены не имеют
        полости. Продукты и упаковки иллюстративные.
      </p>
      {[
        ["walls", "Стены"],
        ["floor", "Пол первого этажа"],
        ["roof", "Потолок / скаты"],
      ].map(([kind, title]) => {
        const value = insulation[kind] ?? {};
        return (
          <fieldset className="nh-material-group" key={kind}>
            <legend>{title}</legend>
            <div className="nh-grid">
              <Select
                label="Продукт"
                value={value.enabled === false ? "none" : (value.product ?? "wool-50")}
                options={[["none", "Не утеплять"], ...insulationProducts.map((p) => [p.id, p.name])]}
                onChange={(product) =>
                  updateInsulation(kind, product === "none" ? { enabled: false } : { product, enabled: true })
                }
              />
              {value.enabled !== false && (
                <>
                  <Select
                    label="Толщина"
                    value={value.thickness === undefined ? "cavity" : "explicit"}
                    options={[
                      ["cavity", "По полости / слоям ограждения"],
                      ["explicit", "Задать, мм"],
                    ]}
                    onChange={(mode) => {
                      const next = { ...value };
                      if (mode === "cavity") delete next.thickness;
                      // Catalog slab thickness is an editable suggestion, not a thermal prescription.
                      else
                        next.thickness = insulationProducts.find(
                          (p) => p.id === (value.product ?? "wool-50"),
                        ).thickness;
                      set({ insulation: { ...insulation, [kind]: next } });
                    }}
                  />
                  {value.thickness !== undefined && (
                    <label className="nh-field">
                      <span>Толщина, мм</span>
                      <div>
                        <input
                          type="number"
                          min="1"
                          value={value.thickness * 1000}
                          onChange={(e) =>
                            updateInsulation(kind, { thickness: Number(e.target.value) / 1000 })
                          }
                        />
                      </div>
                    </label>
                  )}
                  {kind === "roof" && (
                    <Select
                      label="Тепловая граница"
                      value={value.boundary ?? "auto"}
                      options={[
                        ["auto", "Авто · по конструкции"],
                        ["ceiling", "Потолок · холодный чердак"],
                        ["slopes", "Скаты · тёплая кровля"],
                      ]}
                      onChange={(boundary) => {
                        const next = { ...value };
                        if (boundary === "auto") delete next.boundary;
                        else next.boundary = boundary;
                        set({ insulation: { ...insulation, roof: next } });
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </fieldset>
        );
      })}
    </>
  );
}
