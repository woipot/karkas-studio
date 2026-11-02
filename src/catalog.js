/**
 * Assortment of nominal timber sizes, mm. This is not a universal standard,
 * grading specification, availability guarantee or strength classification.
 * Purchased, dried and planed products can have different actual dimensions.
 */
const sizes=[
  [20,100,'board','Обшивка и вспомогательные элементы'],
  [25,100,'board','Обрешётка и вспомогательные элементы'],
  [25,150,'board','Обрешётка и настил'],
  [40,100,'board','Стойки и каркасные элементы после расчёта'],
  [40,150,'board','Стойки и балки после расчёта'],
  [40,200,'board','Балки и стропильные элементы после расчёта'],
  [45,150,'board','Каркасные элементы после расчёта'],
  [45,200,'board','Балки и стропильные элементы после расчёта'],
  [45,250,'board','Балки и стропильные элементы после расчёта'],
  [50,50,'bar','Рейки, обрешётка и вспомогательный каркас'],
  [50,100,'board','Стойки, связи и каркасные элементы после расчёта'],
  [50,150,'board','Стойки и балки после расчёта'],
  [50,200,'board','Балки и стропильные элементы после расчёта'],
  [50,250,'board','Балки и стропильные элементы после расчёта'],
  [100,100,'post','Брус и опорные элементы после расчёта'],
  [100,150,'post','Брус и опорные элементы после расчёта'],
  [150,150,'post','Брус и опорные элементы после расчёта'],
  [200,200,'post','Брус и опорные элементы после расчёта'],
];

export const timberSections=sizes.map(([b,h,category,usage])=>Object.freeze({
  id:`${b}x${h}`,b,h,label:`${b} × ${h} мм`,usage,category,
  volumePerMeter:b*h/1e6,
}));

export const sectionCatalogNote='Номинальные размеры ассортимента. Фактическое сечение после сушки и строгания уточняйте у поставщика. Сортность, влажность и прочность каталог не присваивает.';

/** Orientation is retained: b and h must not be interchanged in mechanics. */
export function parseSection(id){
  if(typeof id!=='string')return null;
  const m=id.match(/^\s*(\d+(?:[.,]\d+)?)\s*(?:[xх×*]|на)\s*(\d+(?:[.,]\d+)?)\s*(?:мм)?\s*$/i);
  if(!m)return null;
  const b=Number(m[1].replace(',','.')),h=Number(m[2].replace(',','.'));
  return b>0&&h>0&&b<=2000&&h<=2000?{b,h}:null;
}

export function sectionById(id){
  const parsed=parseSection(id);
  return parsed?timberSections.find(s=>s.b===parsed.b&&s.h===parsed.h):undefined;
}

/** Kilograms per metre, using a supplied density in kg/m³. */
export function sectionMassPerMeter(id,density=500){
  const s=typeof id==='object'&&id!==null?id:parseSection(id);
  if(!s||!Number.isFinite(s.b)||!Number.isFinite(s.h)||s.b<=0||s.h<=0||!Number.isFinite(density)||density<0)return null;
  return s.b*s.h/1e6*density;
}
