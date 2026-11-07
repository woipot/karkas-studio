/**
 * Site → normative climatic loads (Russia).
 *
 * Normative values:
 *  - SP 20.13330.2016 «Нагрузки и воздействия» (с Изменениями № 1–6):
 *    табл. 10.1 — нормативный вес снегового покрова Sg по снеговым районам (карта 1 прил. Е);
 *    п. 10.2 / прил. К (Изменение № 2) — для городов табл. К.1 Sg принимается по этой таблице;
 *    табл. 11.1 — нормативное значение ветрового давления w0 по ветровым районам (карта 2 прил. Е).
 *  - SP 22.13330.2016 п. 5.5.3: нормативная глубина сезонного промерзания dfn = d0·√Mt,
 *    d0 = 0.23 м для суглинков и глин; Mt — сумма абсолютных среднемесячных отрицательных
 *    температур по SP 131.13330.2025 табл. 7.1. Формула применима при dfn ≤ 2.5 м.
 *
 * Городская таблица — СПРАВОЧНО: районы сведены из нескольких независимых публикаций
 * городских таблиц по картам СП 20 (сверка ≥2 источников), глубина промерзания рассчитана
 * по формуле SP 22 из климатических данных SP 131. Уточняйте по картам СП 20 прил. Е
 * (в ред. 2011 — прил. Ж) и по инженерно-геологическим изысканиям площадки.
 */

export const SNOW_REGIONS = Object.freeze({
  I: 0.5,
  II: 1.0,
  III: 1.5,
  IV: 2.0,
  V: 2.5,
  VI: 3.0,
  VII: 3.5,
  VIII: 4.0,
});
export const WIND_REGIONS = Object.freeze({
  Ia: 0.17,
  I: 0.23,
  II: 0.3,
  III: 0.38,
  IV: 0.48,
  V: 0.6,
  VI: 0.73,
  VII: 0.85,
});
export const TERRAIN_TYPES = Object.freeze({
  A: "открытые побережья морей, озёр и водохранилищ, сельские местности, пустыни, степи, тундра",
  B: "городские территории, лесные массивы и другие местности с препятствиями высотой более 10 м",
  C: "городские районы с плотной застройкой зданиями высотой более 25 м",
});
export const SITE_LOAD_SOURCES = Object.freeze({
  snowTable: {
    title: "СП 20.13330.2016 «Нагрузки и воздействия», табл. 10.1 (снеговые районы, карта 1 прил. Е)",
    url: "https://docs.cntd.ru/document/456044318",
  },
  snowCityTable: {
    title: "СП 20.13330.2016, п. 10.2 и прил. К, табл. К.1 (Изменение № 2): Sg для отдельных городов",
    url: "https://meganorm.ru/mega_doc/norm_update_04112024/pravila/0/sp_20_13330_2016_svod_pravil_nagruzki_i_vozdeystviya.html",
  },
  windTable: {
    title: "СП 20.13330.2016, табл. 11.1 (ветровые районы, карта 2 прил. Е), типы местности п. 11.1.6",
    url: "https://docs.cntd.ru/document/456044318",
  },
  frost: {
    title:
      "СП 22.13330.2016 п. 5.5.3 (dfn = 0.23·√Mt для суглинков и глин); Mt по СП 131.13330.2025 табл. 7.1",
    url: "https://base.garant.ru/71706442/",
  },
  cityRegions: {
    title:
      "Справочные городские таблицы районов по картам СП 20.13330.2016 (сверка нескольких публикаций, напр. lsk-lskos.ru/sr, lsk-lskos.ru/vr, evrazsteelbox.ru)",
    url: "https://lsk-lskos.ru/sr",
  },
});
export const CITY_TABLE_NOTE = "справочно — уточняйте по картам СП 20 прил. Е/Ж и по изысканиям площадки";

// [город, псевдонимы, снеговой район | null, ветровой район | null, Sg по табл. К.1 | null,
//  dfn суглинок/глина м | null, достоверность районов, метеостанция для dfn (если не сам город)]
// null — значение не включено: источники расходятся или формула SP 22 неприменима.
const CITY_ROWS = [
  ["Москва", ["Moscow"], "III", "I", 1.45, 1.03, "high", null],
  ["Санкт-Петербург", ["Saint Petersburg"], "III", "II", 1.3, 0.91, "high", null],
  ["Новосибирск", ["Novosibirsk"], "III", "III", 1.6, 1.8, "medium", null],
  ["Екатеринбург", ["Yekaterinburg"], "III", "I", 1.35, 1.53, "medium", null],
  ["Казань", ["Kazan"], "IV", "II", 2.3, 1.38, "medium", null],
  ["Красноярск", ["Krasnoyarsk"], "III", "III", 1.35, 1.71, "high", null],
  ["Нижний Новгород", ["Nizhny Novgorod"], "IV", "I", 2.1, 1.26, "high", null],
  ["Челябинск", ["Chelyabinsk"], "III", "II", 1.2, 1.63, "high", null],
  ["Уфа", ["Ufa"], "V", "II", 2.45, 1.53, "high", null],
  ["Самара", ["Samara"], "IV", "III", 1.6, 1.34, "high", null],
  ["Ростов-на-Дону", ["Rostov-on-Don"], "II", "III", 0.85, 0.61, "high", null],
  ["Краснодар", ["Krasnodar"], "II", "IV", 1.1, null, "medium", null],
  ["Омск", ["Omsk"], "III", "II", 1.35, 1.79, "high", null],
  ["Воронеж", ["Voronezh"], "III", "II", 1.55, 0.99, "high", null],
  ["Пермь", ["Perm"], "V", "I", 1.95, 1.54, "medium", null],
  ["Волгоград", ["Volgograd"], "II", "III", 1, 0.93, "high", null],
  ["Саратов", ["Saratov"], "III", "III", 1.4, 1.15, "high", null],
  ["Тюмень", ["Tyumen"], "III", "I", 1.6, 1.69, "medium", null],
  ["Тольятти", ["Tolyatti"], "IV", "III", 1.65, 1.34, "high", "Самара"],
  ["Махачкала", ["Makhachkala"], null, "V", 0.6, null, "high", null],
  ["Барнаул", ["Barnaul"], "III", "III", 1.55, 1.72, "medium", null],
  ["Ижевск", ["Izhevsk"], null, "I", 2.15, 1.53, "high", null],
  ["Хабаровск", ["Khabarovsk"], "II", "III", 1.1, 1.87, "high", null],
  ["Ульяновск", ["Ulyanovsk"], null, "II", 1.4, 1.38, "high", null],
  ["Иркутск", ["Irkutsk"], "II", "III", 1.05, 1.81, "high", null],
  ["Владивосток", ["Vladivostok"], "II", "IV", null, 1.32, "high", null],
  ["Ярославль", ["Yaroslavl"], "IV", "I", 1.8, 1.26, "high", null],
  ["Севастополь", ["Sevastopol"], "I", "II", null, null, "high", null],
  ["Ставрополь", ["Stavropol"], "II", "IV", 0.95, 0.51, "medium", null],
  ["Томск", ["Tomsk"], "IV", "III", 2.15, 1.83, "high", null],
  ["Кемерово", ["Kemerovo"], "IV", "III", 1.8, 1.81, "high", null],
  ["Набережные Челны", ["Naberezhnye Chelny"], "V", "II", 2.25, 1.43, "high", "Елабуга"],
  ["Оренбург", ["Orenburg"], "III", "III", 1.25, 1.49, "medium", null],
  ["Новокузнецк", ["Novokuznetsk"], "IV", "III", 1.8, 1.67, "high", "Киселевск"],
  ["Рязань", ["Ryazan"], "III", "I", 1.55, 1.15, "high", null],
  ["Чебоксары", ["Cheboksary"], "IV", "I", 1.95, 1.38, "medium", null],
  ["Пенза", ["Penza"], "III", "II", 1.45, 1.27, "high", null],
  ["Липецк", ["Lipetsk"], "III", "II", 1.5, 1.13, "high", null],
  ["Калининград", ["Kaliningrad"], "II", "II", 0.8, 0.39, "high", null],
  ["Тула", ["Tula"], "III", "I", 1.5, 1.11, "medium", null],
  ["Киров", ["Kirov"], null, "I", 2.1, 1.48, "high", null],
  ["Астрахань", ["Astrakhan"], "I", "III", 0.4, 0.72, "high", null],
  ["Симферополь", ["Simferopol"], "I", "II", null, null, "high", null],
  ["Курск", ["Kursk"], "III", "II", 1.25, 0.99, "high", null],
  ["Улан-Удэ", ["Ulan-Ude"], "I", "III", 0.45, 2.04, "medium", null],
  ["Сочи", ["Sochi"], "II", "III", null, null, "medium", null],
  ["Тверь", ["Tver"], "III", "I", 1.6, 1.13, "medium", null],
  ["Магнитогорск", ["Magnitogorsk"], "III", "II", 1.3, null, "medium", null],
  ["Иваново", ["Ivanovo"], "IV", "I", 1.7, 1.27, "high", null],
  ["Брянск", ["Bryansk"], "III", "I", 1.6, 0.98, "high", null],
  ["Сургут", ["Surgut"], "IV", "I", 1.8, 2.05, "medium", null],
  ["Белгород", ["Belgorod"], "III", "II", 1.55, 0.9, "high", null],
  ["Владимир", ["Vladimir"], "IV", "I", 1.85, 1.22, "medium", null],
  ["Якутск", ["Yakutsk"], "II", "I", 0.7, null, "medium", null],
  ["Чита", ["Chita"], "I", "II", 0.4, 2.17, "high", null],
  ["Архангельск", ["Arkhangelsk"], "IV", "II", 1.8, 1.5, "high", null],
  ["Нижний Тагил", ["Nizhny Tagil"], "III", "I", 1.5, 1.65, "medium", null],
  ["Калуга", ["Kaluga"], null, "I", 1.9, 1.09, "high", null],
  ["Смоленск", ["Smolensk"], "III", "I", 1.6, 1.01, "high", null],
  ["Волжский", ["Volzhsky"], "II", "III", 1, 0.93, "medium", "Волгоград"],
  ["Курган", ["Kurgan"], "III", "II", 1.3, 1.72, "high", null],
  ["Череповец", ["Cherepovets"], "IV", "I", 1.85, null, "high", null],
  ["Саранск", ["Saransk"], "III", "II", 1.6, 1.32, "high", null],
  ["Орёл", ["Oryol"], "III", "II", 1.4, 1.03, "high", null],
  ["Вологда", ["Vologda"], "IV", "I", 1.65, 1.37, "high", null],
  ["Мурманск", ["Murmansk"], null, "IV", 3.2, 1.42, "high", null],
  ["Грозный", ["Grozny"], "I", "IV", 0.45, 0.44, "medium", null],
  ["Владикавказ", ["Vladikavkaz"], null, "IV", 0.65, null, "high", null],
  ["Тамбов", ["Tambov"], "III", "II", 1.4, 1.15, "high", null],
  ["Стерлитамак", ["Sterlitamak"], "V", "III", 2.2, null, "high", null],
  ["Кострома", ["Kostroma"], "IV", "I", 1.8, 1.28, "high", null],
  ["Петрозаводск", ["Petrozavodsk"], "IV", "II", 1.7, 1.26, "medium", null],
  ["Нижневартовск", ["Nizhnevartovsk"], "V", "I", 2.3, null, "medium", null],
  ["Йошкар-Ола", ["Yoshkar-Ola"], "IV", "I", 1.8, 1.41, "high", null],
  ["Новороссийск", ["Novorossiysk"], "I", "VI", null, null, "medium", null],
  ["Таганрог", ["Taganrog"], "II", "III", 0.85, 0.57, "medium", null],
  ["Великий Новгород", ["Veliky Novgorod"], "III", "I", 1.55, 1.01, "high", null],
  ["Псков", ["Pskov"], "III", "I", 1.3, 0.9, "high", null],
  ["Балашиха", ["Balashikha"], "III", "I", null, 1.1, "high", null],
  ["Подольск", ["Podolsk"], "III", "I", null, 1.1, "high", null],
  ["Химки", ["Khimki"], "III", "I", null, 1.1, "high", null],
  ["Мытищи", ["Mytishchi"], "III", "I", null, 1.1, "high", null],
  ["Королёв", ["Korolyov", "Королев"], "III", "I", null, 1.1, "medium", null],
  ["Люберцы", ["Lyubertsy"], "III", "I", null, 1.1, "high", null],
  ["Одинцово", ["Odintsovo"], "III", "I", null, 1.1, "medium", null],
  ["Электросталь", ["Elektrostal"], "III", "I", null, 1.14, "high", "Павловский Посад"],
  ["Ногинск", ["Noginsk"], "III", "I", null, 1.14, "high", "Павловский Посад"],
  ["Орехово-Зуево", ["Orekhovo-Zuyevo"], "III", "I", null, 1.14, "high", "Павловский Посад"],
  ["Коломна", ["Kolomna"], "III", "I", 1.45, 1.15, "high", "Кашира"],
  ["Серпухов", ["Serpukhov"], "III", "I", 1.5, 1.15, "high", "Кашира"],
  ["Сергиев Посад", ["Sergiev Posad"], "III", "I", 1.6, 1.14, "medium", "Дмитров"],
  ["Дмитров", ["Dmitrov"], "III", "I", 1.45, 1.14, "medium", null],
  ["Клин", ["Klin"], null, "I", 1.85, 1.14, "medium", "Дмитров"],
  ["Наро-Фоминск", ["Naro-Fominsk"], "III", "I", null, 1.12, "medium", null],
];

export class SiteLoadsError extends Error {
  constructor(field, message) {
    super(message);
    this.name = "SiteLoadsError";
    this.code = "INVALID_SITE";
    this.errors = [{ field, message }];
  }
}

const normalizeName = (s) =>
  String(s)
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/^\s*(г\.|город|city of)\s*/u, "")
    .replace(/[\s\-‐–—_.,]+/gu, " ")
    .trim();

export const SITE_CITIES = Object.freeze(
  CITY_ROWS.map(([city, aliases, snowRegion, windRegion, sgTableK, frostDepth, confidence, frostStation]) =>
    Object.freeze({
      city,
      aliases: Object.freeze([...aliases]),
      snowRegion,
      windRegion,
      sgTableK,
      frostDepth,
      confidence,
      frostStation,
    }),
  ),
);
const cityIndex = new Map();
for (const c of SITE_CITIES) for (const name of [c.city, ...c.aliases]) cityIndex.set(normalizeName(name), c);

/** Find a reference city by name (case-, ё/е-, hyphen- and «г.»-insensitive). */
export function findSiteCity(name) {
  if (typeof name !== "string" || !name.trim()) return null;
  return cityIndex.get(normalizeName(name)) ?? null;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
function region(value, table, field) {
  if (value === undefined || value === null || value === "") return null;
  let v = typeof value === "number" ? (Number.isInteger(value) ? ROMAN[value - 1] : null) : String(value);
  if (v === null)
    throw new SiteLoadsError(field, `${field}: римский номер района (${Object.keys(table).join(", ")}).`);
  v = v.trim().replaceAll("а", "a").replaceAll("А", "a").replaceAll("І", "I");
  const digits = v.match(/^(\d+)(a?)$/i);
  if (digits) v = (ROMAN[Number(digits[1]) - 1] ?? v) + digits[2];
  const key = Object.keys(table).find((k) => k.toLowerCase() === v.toLowerCase());
  if (!key)
    throw new SiteLoadsError(field, `${field}: римский номер района (${Object.keys(table).join(", ")}).`);
  return key;
}

/**
 * Normative site loads. Explicit regions win over the city table.
 * Returns kPa values ready for project.loads (snow = Sg, wind = w0) and project.site metadata.
 */
export function siteLoads({ city, snowRegion, windRegion, terrain } = {}) {
  const warnings = [],
    basis = {};
  if (city !== undefined && (typeof city !== "string" || city.length > 120))
    throw new SiteLoadsError("city", "city: название населённого пункта строкой до 120 символов.");
  const explicitSnow = region(snowRegion, SNOW_REGIONS, "snowRegion"),
    explicitWind = region(windRegion, WIND_REGIONS, "windRegion"),
    t =
      terrain === undefined || terrain === null
        ? "B"
        : String(terrain).toUpperCase().replace("А", "A").replace("В", "B").replace("С", "C");
  if (!TERRAIN_TYPES[t])
    throw new SiteLoadsError("terrain", "terrain: тип местности A, B или C (СП 20 п. 11.1.6).");
  const entry = city ? findSiteCity(city) : null;
  if (city && !entry)
    warnings.push(
      `Город «${city}» не найден в справочной таблице; снег и ветер берутся только из явно заданных районов. Определите районы по картам СП 20.13330.2016 прил. Е.`,
    );
  if (entry && entry.confidence !== "high")
    warnings.push(
      `${entry.city}: районы по справочным таблицам совпадают не во всех источниках (достоверность ${entry.confidence}); проверьте по картам СП 20 прил. Е.`,
    );
  let snow = null,
    sr = explicitSnow ?? entry?.snowRegion ?? null;
  if (explicitSnow) {
    snow = SNOW_REGIONS[explicitSnow];
    basis.snow = `СП 20.13330.2016 табл. 10.1: снеговой район ${explicitSnow} задан явно → Sg = ${snow} кПа.`;
    if (entry?.sgTableK !== null && entry?.sgTableK !== undefined)
      warnings.push(
        `${entry.city} есть в табл. К.1 СП 20 (Sg = ${entry.sgTableK} кПа), но использован явно заданный район ${explicitSnow}.`,
      );
  } else if (entry?.sgTableK !== null && entry?.sgTableK !== undefined) {
    snow = entry.sgTableK;
    basis.snow = `СП 20.13330.2016 п. 10.2, прил. К табл. К.1: ${entry.city} → Sg = ${snow} кПа${
      entry.snowRegion
        ? ` (снеговой район ${entry.snowRegion}, по табл. 10.1 было бы ${SNOW_REGIONS[entry.snowRegion]} кПа)`
        : ""
    }.`;
  } else if (entry?.snowRegion) {
    snow = SNOW_REGIONS[entry.snowRegion];
    basis.snow = `СП 20.13330.2016 табл. 10.1: ${entry.city} — снеговой район ${entry.snowRegion} (справочно) → Sg = ${snow} кПа.`;
  } else {
    if (entry)
      warnings.push(`${entry.city}: снеговой район в справочной таблице не определён; задайте snowRegion.`);
    basis.snow = "Снеговая нагрузка по площадке не определена.";
  }
  let wind = null;
  const wr = explicitWind ?? entry?.windRegion ?? null;
  if (wr) {
    wind = WIND_REGIONS[wr];
    basis.wind = `СП 20.13330.2016 табл. 11.1: ветровой район ${wr}${explicitWind ? " задан явно" : ` (${entry.city}, справочно)`} → w0 = ${wind} кПа.`;
  } else {
    if (entry)
      warnings.push(`${entry.city}: ветровой район в справочной таблице не определён; задайте windRegion.`);
    basis.wind = "Ветровая нагрузка по площадке не определена.";
  }
  basis.terrain = `Тип местности ${t}${terrain === undefined || terrain === null ? " (по умолчанию)" : ""}: ${TERRAIN_TYPES[t]}. Коэффициент k(ze) применяет расчётное ядро.`;
  const frostDepth = entry?.frostDepth ?? null;
  basis.frostDepth =
    frostDepth === null
      ? entry
        ? `${entry.city}: нормативная глубина промерзания не включена (Mt = 0, формула неприменима или нет метеостанции); требуется теплотехнический расчёт/изыскания.`
        : "Глубина промерзания не определена."
      : `СП 22.13330.2016 п. 5.5.3: dfn = 0.23·√Mt для суглинков и глин, Mt по СП 131.13330.2025${
          entry.frostStation ? ` (метеостанция ${entry.frostStation})` : ""
        } → ${frostDepth} м. Нормативная, не расчётная глубина: df = kh·dfn; для супесей/песков d0 больше.`;
  if (frostDepth !== null)
    warnings.push("Глубина промерзания — справочная нормативная величина; длину свай определяют изыскания.");
  const source = entry
    ? `Справочная таблица КАРКАС: ${entry.city} (${CITY_TABLE_NOTE})`
    : explicitSnow || explicitWind
      ? "Явно заданные районы СП 20.13330.2016"
      : null;
  return {
    snow,
    wind,
    terrain: t,
    frostDepth,
    snowRegion: sr,
    windRegion: wr,
    city: entry?.city ?? city ?? null,
    matched: Boolean(entry),
    fromTable: {
      snow: !explicitSnow && snow !== null,
      wind: !explicitWind && wind !== null,
      frostDepth: frostDepth !== null,
    },
    basis,
    warnings,
    site: {
      city: entry?.city ?? city ?? null,
      snowRegion: sr,
      windRegion: wr,
      frostDepth,
      source,
    },
    sources: SITE_LOAD_SOURCES,
    note: CITY_TABLE_NOTE,
  };
}
