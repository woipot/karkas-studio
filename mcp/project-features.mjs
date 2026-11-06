import * as z from "zod/v4";
const num = (lo, hi) => z.number().finite().min(lo).max(hi);
const id = z.string().min(1).max(120);
const section = z.string().regex(/^\d{2,3}[x×]\d{2,3}$/);
const point = z.object({ x: num(-1000, 1000), y: num(-1000, 1000) }).strict();
const polygon = z.array(point).min(3).max(100);
const overhangs = z
  .object({
    low: num(0, 2).optional(),
    high: num(0, 2).optional(),
    start: num(0, 2).optional(),
    end: num(0, 2).optional(),
  })
  .strict();
export const annexSchema = z
  .object({
    id,
    name: z.string().max(160).optional(),
    kind: z
      .enum(["openTerrace", "coveredTerrace", "glazedVeranda"])
      .describe("Uncovered open deck; open roofed terrace; unheated glazed veranda."),
    attachedWallId: id,
    offset: num(0, 100),
    width: num(0.8, 12),
    depth: num(0.8, 8),
    gap: num(0, 0.5).optional(),
    deckTopY: num(-100, 100).nullable().optional(),
    foundation: z
      .object({
        mode: z.enum(["independent", "shared"]).optional(),
        spacing: num(0.5, 6).optional(),
        capacity: num(1, 1000).optional(),
        edgeInset: num(0.1, 2).optional(),
        pileHeadY: num(-100, 100).nullable().optional(),
        grillage: z
          .object({
            section: section.optional(),
            plies: z.number().int().min(1).max(6).optional(),
            capSize: num(50, 1500).optional(),
            deflectionRatio: num(100, 1000).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    floor: z
      .object({
        section: section.optional(),
        spacing: num(0.2, 1.2).optional(),
        deckThickness: num(0.015, 0.06).optional(),
        blockingStep: num(0.3, 3).optional(),
      })
      .strict()
      .optional(),
    roof: z
      .object({
        pitch: num(2, 45).optional(),
        lowEaveHeight: num(1.8, 5).optional(),
        section: section.optional(),
        spacing: num(0.2, 1.2).optional(),
        beamSection: section.optional(),
        beamPlies: z.number().int().min(1).max(8).optional(),
        postSection: section.optional(),
        battenSection: section.optional(),
        battenStep: num(0.05, 1.2).optional(),
        overhangs: overhangs.optional(),
      })
      .strict()
      .optional(),
    glazing: z
      .object({
        section: section.optional(),
        panelWidth: num(0.3, 3).optional(),
        dead: num(0, 3).optional(),
        doorSide: z.enum(["front", "left", "right"]).optional(),
        doorOffset: num(0, 100).optional(),
        doorWidth: num(0.6, 2.5).optional(),
        doorHeight: num(1.8, 3).optional(),
      })
      .strict()
      .optional(),
    loads: z
      .object({
        floorDead: num(0, 20).optional(),
        live: num(0, 20).optional(),
        roofDead: num(0, 20).optional(),
        snow: num(0, 20).optional(),
        wind: num(0, 5).optional(),
        gammaG: num(1, 3).optional(),
        gammaQ: num(1, 3).optional(),
        snowMu: num(0, 2).optional(),
        deckSnowFactor: num(0, 3).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .describe(
    "Separate parametric annex in the exterior local frame of a real first-floor wall. Foundation can be independent or shared with the house; shared mode requires compatible section/plies, level and capacity. Connection, drainage, drift and soil remain explicit checks. All sizes in metres except timber sections/capSize in mm.",
  );
export const galleryPathSchema = z.object({ id, polygon, minWidth: num(0.3, 3).optional() }).strict();
export const doubleHeightSpaceSchema = z
  .object({
    id,
    voidId: id,
    lowerRoomId: id,
    galleryPaths: z.array(galleryPathSchema).max(20),
    daylightOpeningIds: z.array(id).max(100).optional(),
  })
  .strict();
export const spatialLayoutSchema = z
  .object({
    guardHeight: num(0.8, 1.5).optional(),
    maxGuardGap: num(0.05, 0.2).optional(),
    maxPostSpacing: num(0.4, 2).optional(),
    minGalleryWidth: num(0.5, 2).optional(),
    minStairClearWidth: num(0.5, 2).optional(),
  })
  .strict();
export const staircaseSchema = z
  .object({
    id: id.optional(),
    voidId: id,
    levelFrom: z.number().int().min(1).max(2),
    levelTo: z.number().int().min(1).max(2),
    kind: z.literal("u-turn"),
    polygon,
    risers: z
      .number()
      .int()
      .min(8)
      .max(40)
      .refine((n) => n % 2 === 0, "U stair requires an even number of risers"),
    flightWidth: num(0.6, 2).optional(),
    clearFlightWidth: num(0.6, 2).optional(),
    flightGap: num(0, 0.6).optional(),
    landingLength: num(0.6, 3),
    tread: num(0.2, 0.4),
    riser: num(0.1, 0.25).optional(),
    riserThickness: num(10, 40).optional(),
    exit: z.enum(["east", "west", "north", "south"]).optional(),
    treadSection: section.optional(),
    stringerSection: section.optional(),
    postSection: section.optional(),
    railSection: section.optional(),
    balusterSection: section.optional(),
    landingBeamSection: section.optional(),
    landingPostSection: section.optional(),
    direction: z.string().max(500).optional(),
    note: z.string().max(2000).optional(),
    status: z.string().max(50).optional(),
  })
  .strict();
export const doubleHeightConfigurationSchema = z
  .object({
    opening: z
      .object({
        id,
        level: z.literal(2),
        kind: z.literal("doubleHeight"),
        polygon,
        edgeSection: section,
        edgePlies: z.number().int().min(1).max(6).optional(),
      })
      .strict(),
    space: doubleHeightSpaceSchema,
    staircase: staircaseSchema.optional(),
    spatialLayout: spatialLayoutSchema.optional(),
    replaceVoidIds: z.array(id).max(100).optional(),
  })
  .strict();
