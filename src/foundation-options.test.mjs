import test from "node:test";
import assert from "node:assert/strict";
import {
  compareFoundationOptions,
  foundationOptionTypes,
  FoundationOptionsInputError,
} from "./foundation-options.js";
import { defaultDesignerProject, calculateDesigner } from "./designer-engine.js";
const clone = (x) => JSON.parse(JSON.stringify(x));
const sample = () => ({
  project: { foundation: { capacity: 80 } },
  result: {
    foundation: { maxReaction: 24.75, count: 3 },
    piles: [{ reaction: 11 }, { reaction: 24.75 }, { reaction: 8 }],
  },
});
const type = (r, id) => r.candidates.find((c) => c.type === id);

test("foundation demand envelopes actual snow cases and preserves a governing sensitivity label", () => {
  const { project, result } = sample();
  result.snowAssessment = {
    cases: [
      { id: "asym", name: "Неравномерная схема", kind: "load_arrangement", maxPileReaction: 26 },
      { id: "stress", name: "150% · чувствительность", kind: "sensitivity", maxPileReaction: 31.5 },
    ],
  };
  const r = compareFoundationOptions(project, result);
  assert.equal(r.maxDesignReaction, 31.5);
  assert.equal(r.demand.baselineMaxReaction, 24.75);
  assert.equal(r.demand.governingCase.id, "stress");
  assert.equal(r.demand.governingCase.kind, "sensitivity");
  assert.ok(r.candidates.every((c) => c.maxDesignReaction === 31.5 && c.designResistance === null));
  result.snowAssessment.cases[0].maxPileReaction = NaN;
  assert.throws(() => compareFoundationOptions(project, result), FoundationOptionsInputError);
});

test("unknown geology retains all four conditional technologies with no invented resistance, length, price or approval", () => {
  const { project, result } = sample(),
    r = compareFoundationOptions(project, result);
  assert.deepEqual(
    r.candidates.map((c) => c.type),
    foundationOptionTypes,
  );
  assert.equal(r.certified, false);
  assert.equal(r.provisionalChoice.type, "steel_drilled_RD");
  for (const c of r.candidates) {
    assert.equal(c.status, "conditional");
    assert.equal(c.certified, false);
    assert.equal(c.designResistance, null);
    assert.equal(c.pileLength, null);
    assert.equal(c.steelDiameter, null);
    assert.equal(c.estimatedPrice, null);
    assert.equal(c.capacityStatus, "unverified");
    assert.ok(c.checks.every((q) => q.status === "unverified"));
  }
  assert.equal(r.capacityInput.status, "assumed-example");
  assert.equal(r.capacityInput.usedForCandidateApproval, false);
  assert.ok(r.requiredInvestigations.length >= 5);
  assert.ok(r.sources.some((s) => s.url.includes("ssab.com")));
  assert.ok(r.sources.some((s) => s.url.includes("elementtisuunnittelu.fi")));
});
test("demand comes from actual engine reactions and changing an example 80kN capacity cannot validate a technology", () => {
  const p = clone(defaultDesignerProject),
    r = calculateDesigner(p),
    a = compareFoundationOptions(p, r);
  assert.equal(a.maxDesignReaction, Math.max(...r.piles.map((q) => q.reaction)));
  assert.equal(a.pileCount, r.piles.length);
  p.foundation.capacity = 80;
  const b = compareFoundationOptions(p, r);
  assert.equal(b.maxDesignReaction, a.maxDesignReaction);
  assert.deepEqual(b.candidates, a.candidates);
  assert.equal(b.capacityInput.value, 80);
  assert.equal(b.capacityInput.geotechnicalResistanceVerified, false);
});
test("boulders, shallow rock and vibration sensitivity favour only a provisional RD investigation scenario", () => {
  const { project, result } = sample();
  for (const site of [
    { soilProfile: "unknown", boulders: true },
    { soilProfile: "shallow-bedrock" },
    { soilProfile: "soft-over-bearing", vibrationSensitive: true },
  ]) {
    const r = compareFoundationOptions(project, result, site);
    assert.equal(r.provisionalChoice.type, "steel_drilled_RD");
    assert.equal(r.provisionalChoice.status, "conditional");
    assert.equal(r.provisionalChoice.certified, false);
  }
  const blocked = compareFoundationOptions(project, result, {
    soilProfile: "unknown",
    largeRigAccess: false,
  });
  assert.equal(type(blocked, "reinforced_concrete_driven_250").status, "excluded");
  assert.ok(type(blocked, "steel_drilled_RD").conditions.some((s) => s.includes("доступ")));
});
test("passable driven scenarios distinguish RC access from RR while never calculating a resistance", () => {
  const { project, result } = sample(),
    site = {
      soilProfile: "soft-over-bearing",
      boulders: false,
      vibrationSensitive: false,
      largeRigAccess: true,
    };
  const rc = compareFoundationOptions(project, result, site);
  assert.equal(rc.provisionalChoice.type, "reinforced_concrete_driven_250");
  assert.deepEqual(type(rc, rc.provisionalChoice.type).nominalSectionMM, [250, 250]);
  const rr = compareFoundationOptions(project, result, { ...site, largeRigAccess: false });
  assert.equal(rr.provisionalChoice.type, "steel_driven_RR");
  assert.equal(type(rr, "reinforced_concrete_driven_250").status, "excluded");
  assert.equal(type(rr, "steel_driven_RR").designResistance, null);
});
test("screw piles need verified eligible soil and remain conditional without a site-specific load test", () => {
  const { project, result } = sample(),
    site = {
      soilProfile: "dense-granular",
      boulders: false,
      vibrationSensitive: false,
      largeRigAccess: false,
    };
  assert.equal(type(compareFoundationOptions(project, result, site), "steel_helical").status, "excluded");
  const known = compareFoundationOptions(project, result, { ...site, geotechnicalVerified: true });
  assert.equal(known.provisionalChoice.type, "steel_helical");
  const c = type(known, "steel_helical");
  assert.equal(c.status, "conditional");
  assert.equal(c.designResistance, null);
  assert.ok(c.conditions.some((s) => s.includes("испытания")));
  assert.equal(known.certified, false);
  assert.equal(
    type(
      compareFoundationOptions(project, result, { ...site, geotechnicalVerified: true, boulders: true }),
      "steel_helical",
    ).status,
    "excluded",
  );
});
test("document evidence is carried as provenance without pretending it has been technically verified", () => {
  const { project, result } = sample();
  project.foundation.capacityEvidence = { reference: "Site A / geotechnical report 12" };
  const r = compareFoundationOptions(project, result, { geotechnicalVerified: true });
  assert.equal(r.capacityInput.status, "documented-input");
  assert.equal(r.capacityInput.evidenceReference, project.foundation.capacityEvidence.reference);
  assert.equal(r.capacityInput.geotechnicalResistanceVerified, false);
  assert.equal(r.capacityInput.usedForCandidateApproval, false);
  assert.ok(r.candidates.every((c) => c.status === "conditional"));
});
test("malformed site, nonfinite demand and inconsistent pile summaries fail explicitly", () => {
  for (const transform of [
    (x) => (x.site = null),
    (x) => (x.site = { soilProfile: "Helsinki" }),
    (x) => (x.site = { soilProfile: null }),
    (x) => (x.site = { boulders: "yes" }),
    (x) => (x.site = { allowableBearing: 80 }),
    (x) => (x.result.foundation.maxReaction = NaN),
    (x) => (x.result.foundation.maxReaction = -1),
    (x) => (x.result.foundation.count = 2),
    (x) => (x.result.piles[0].reaction = Infinity),
    (x) => (x.result.foundation.maxReaction = 30),
    (x) => (x.project.foundation.capacity = Infinity),
    (x) => (x.project.foundation.capacityEvidence = {}),
  ]) {
    const x = { ...sample(), site: {} };
    transform(x);
    assert.throws(
      () => compareFoundationOptions(x.project, x.result, x.site),
      (e) => e instanceof FoundationOptionsInputError && e.code === "INVALID_FOUNDATION_OPTIONS",
    );
  }
});
test("comparison is deterministic, serializable and never mutates source projects or calculated reactions", () => {
  const x = {
      ...sample(),
      site: { soilProfile: "dense-granular", vibrationSensitive: false, boulders: false },
    },
    before = JSON.stringify(x),
    a = compareFoundationOptions(x.project, x.result, x.site),
    b = compareFoundationOptions(x.project, x.result, x.site);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(x), before);
  assert.doesNotThrow(() => JSON.stringify(a));
});

test("unknown Russian site does not default to a Finnish RD product family", () => {
  const { project, result } = sample();
  project.site = { country: "RU" };
  const r = compareFoundationOptions(project, result);
  assert.equal(r.provisionalChoice.type, null);
  assert.equal(r.provisionalChoice.status, "unverified");
  assert.ok(r.candidates.every((c) => c.designResistance === null));
});
