import test from "node:test";
import assert from "node:assert/strict";
import {
  siteLoads,
  findSiteCity,
  SITE_CITIES,
  SNOW_REGIONS,
  WIND_REGIONS,
  SiteLoadsError,
} from "./site-loads.js";

test("SP 20.13330.2016 tables 10.1 and 11.1 normative values", () => {
  assert.deepEqual(Object.values(SNOW_REGIONS), [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]);
  assert.deepEqual(Object.keys(WIND_REGIONS), ["Ia", "I", "II", "III", "IV", "V", "VI", "VII"]);
  assert.deepEqual(Object.values(WIND_REGIONS), [0.17, 0.23, 0.3, 0.38, 0.48, 0.6, 0.73, 0.85]);
});

test("Москва: snow region III / wind region I, Sg from Table К.1 where the norm lists the city", () => {
  const r = siteLoads({ city: "Москва" });
  assert.equal(r.snowRegion, "III");
  assert.equal(r.windRegion, "I");
  assert.equal(r.wind, 0.23);
  // SP 20 п.10.2 (Change 2): Table К.1 value replaces the region value 1.5 kPa for listed cities.
  assert.equal(r.snow, 1.45);
  assert.match(r.basis.snow, /К\.1/);
  assert.match(r.basis.snow, /1\.5/);
  assert.equal(r.terrain, "B");
  assert.equal(r.matched, true);
  assert.equal(r.site.city, "Москва");
  assert.ok(r.site.source.includes("справочно"));
  assert.ok(r.frostDepth > 0.8 && r.frostDepth < 1.6);
  assert.deepEqual(r.fromTable, { snow: true, wind: true, frostDepth: true });
});

test("lookup is case-, ё- and prefix-insensitive with aliases; Moscow-region towns use the region table", () => {
  for (const name of ["москва", "МОСКВА", " г. Москва ", "Moscow"])
    assert.equal(findSiteCity(name)?.city, "Москва");
  assert.equal(findSiteCity("Королев")?.city, "Королёв");
  assert.equal(findSiteCity("орел")?.city, "Орёл");
  assert.equal(findSiteCity("ростов на дону")?.city, "Ростов-на-Дону");
  const n = siteLoads({ city: "Ногинск" });
  assert.equal(n.snowRegion, "III");
  assert.equal(n.snow, 1.5);
  assert.equal(n.wind, 0.23);
  assert.equal(siteLoads({ city: "Санкт-Петербург" }).windRegion, "II");
  assert.ok(SITE_CITIES.length >= 60);
  assert.ok(SITE_CITIES.every((c) => c.city && c.confidence));
});

test("unknown city warns instead of crashing; explicit regions override the table", () => {
  const u = siteLoads({ city: "Атлантида" });
  assert.equal(u.snow, null);
  assert.equal(u.wind, null);
  assert.equal(u.matched, false);
  assert.ok(u.warnings.some((w) => w.includes("не найден")));
  const e = siteLoads({ city: "Москва", snowRegion: "IV", windRegion: 2, terrain: "c" });
  assert.equal(e.snow, 2.0);
  assert.equal(e.wind, 0.3);
  assert.equal(e.terrain, "C");
  assert.equal(e.fromTable.snow, false);
  assert.ok(e.warnings.some((w) => w.includes("К.1")));
  assert.equal(siteLoads({ windRegion: "1а" }).wind, 0.17);
  assert.throws(() => siteLoads({ snowRegion: "IX" }), SiteLoadsError);
  assert.throws(() => siteLoads({ terrain: "D" }), SiteLoadsError);
});
