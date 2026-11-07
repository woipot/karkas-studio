/** Market dimensions are NOT assigned by GOST 8486-86: its §§1.2, 2.2–2.3
 * cover sawn timber sizes/quality/moisture, not a manufacturer's machined profile.
 * Sources checked 2026-11-07; b = wall width, h = envelope height, mm.
 * https://sibir-42.ru/profilirovannyj-brus/ (90/140, 140/140, 140/190, 190/190; 6 m)
 * https://www.grosdom.ru/prays-list-profilirovannyy-brus (145/195, 195/195)
 * https://svls.ru/product-category/brus/brus-profilirovannyj/ (145/145, 145/195)
 * https://normabrus.ru/produktsiya/sukhoy-profilirovannyy-brus/ (200/200 nominal;
 * supplier distinguishes its 190/190 working size). Verify the purchased drawing.
 */
export const profiledBeamSections = [
  [90, 140],
  [140, 140],
  [140, 190],
  [145, 145],
  [145, 195],
  [190, 190],
  [195, 195],
  [200, 200],
].map(([b, h]) => Object.freeze({ id: `${b}x${h}`, b, h, label: `${b} × ${h} мм`, stockLength: 6 }));
// Profile names/practice: https://dobridom-okt.ru/products/the-timber-drying-chamber-produce.html
// and https://molles.su/suhoy-profilirovannyj-brus. No tooth dimensions are invented.
export const beamProfiles = { comb: "Гребёнка", doubleTongue: "Двойной шип", finnish: "Финский" };
export const beamMoistures = { natural: "Естественная влажность", kilnDried: "Камерная сушка 12–18%" };
export const beamCornerJoints = {
  warmCorner: "Тёплый угол",
  lap: "Вполдерева",
  dovetail: "Ласточкин хвост",
  overhang: "С остатком",
};
export const beamSection = (id) =>
  profiledBeamSections.find((s) => s.id === (typeof id === "string" ? id.replace("×", "x") : null));
export const isBeamWall = (w) => w?.system === "profiledBeam";
// Adopted upper end of the 4–6% natural-moisture industry range (not a code value):
// https://xn--b1aahbqh4apcdfe.xn--p1ai/blog/kogda-mozhno-pristupat-k-otdelke-doma-iz-brusa
// Dry solid timber: 3% per https://arhzavod.ru/info/articles/tablitsy-sdviga-skatov/
// Kiln drying is not a guarantee: producer examples range from 12±3% (svls) to 16–18% (spk-ecodom).
export const beamSettlementRatios = { natural: 0.06, kilnDried: 0.03 };
// Adopted 1.2 m within supplier recommendation 1–1.5 m, staggered:
// https://pilomaterials.ru/blog/sposoby-krepleniya-brusa/. Diameter/strength not certified.
// comb/natural/warmCorner/jute are adopted initial choices, not mandatory GOST rules.
export const beamDefaults = Object.freeze({
  profile: "comb",
  moisture: "natural",
  cornerJoint: "warmCorner",
  dowelSpacing: 1.2,
  jute: true,
});
export function resolveBeam(w) {
  const s = beamSection(w.beam?.section);
  return { ...beamDefaults, ...w.beam, ...s, courseHeight: w.beam?.courseHeight ?? s?.h / 1000 };
}
/** Frame algorithms interpret section.h as wall depth. Never use beam height as thickness. */
export function wallFrameSection(w, parse) {
  if (!isBeamWall(w)) return parse(w?.section);
  const s = beamSection(w.beam?.section);
  return s ? parse(`${s.b}x${s.b}`) : null;
}
