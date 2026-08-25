import { describe, expect, it } from "bun:test";
import {
  applyUpdatePreset,
  DOCUMENTS_RECEIVED,
  documentsToColumns,
  INTAKE_PRIORITY,
  label,
  LOST_REASONS,
  MISSING_INFORMATION,
  ON_HOLD_REASONS,
  REQUEST_TYPES,
  requiresNote,
  UPDATE_PRESETS,
  validateMultiSelection,
  validateSelection,
  type PresetOption,
} from "@/lib/entry-presets";
import { INTAKE_REQUEST_TYPES } from "@/lib/inbox-actions";

const ALL_LISTS: Array<[string, PresetOption[]]> = [
  ["DOCUMENTS_RECEIVED", DOCUMENTS_RECEIVED],
  ["REQUEST_TYPES", REQUEST_TYPES],
  ["MISSING_INFORMATION", MISSING_INFORMATION],
  ["INTAKE_PRIORITY", INTAKE_PRIORITY],
  ["LOST_REASONS", LOST_REASONS],
  ["ON_HOLD_REASONS", ON_HOLD_REASONS],
];

describe("every list is bilingual and well-formed", () => {
  for (const [name, list] of ALL_LISTS) {
    it(`${name} has an English and Arabic label for every option`, () => {
      for (const o of list) {
        expect(o.en.trim().length).toBeGreaterThan(0);
        expect(o.ar.trim().length).toBeGreaterThan(0);
        expect(o.value).toMatch(/^[a-z_]+$/);
      }
    });

    it(`${name} has no duplicate values`, () => {
      expect(new Set(list.map((o) => o.value)).size).toBe(list.length);
    });
  }

  it("returns the right label per language", () => {
    const price = LOST_REASONS.find((o) => o.value === "price")!;
    expect(label(price, "en")).toBe("Price");
    expect(label(price, "ar")).toBe("السعر");
  });
});

// A taxonomy that cannot express reality gets worked around.
describe("every open-ended list keeps an escape hatch", () => {
  for (const [name, list] of [
    ["DOCUMENTS_RECEIVED", DOCUMENTS_RECEIVED],
    ["MISSING_INFORMATION", MISSING_INFORMATION],
    ["LOST_REASONS", LOST_REASONS],
    ["ON_HOLD_REASONS", ON_HOLD_REASONS],
  ] as Array<[string, PresetOption[]]>) {
    it(`${name} offers Other, and Other demands a note`, () => {
      const other = list.find((o) => o.value === "other");
      expect(other).toBeDefined();
      expect(other!.requiresNote).toBe(true);
    });
  }

  // A closed set of exactly four request types — an "other" here would break
  // the Phase 2 routing that switches on this value.
  it("REQUEST_TYPES is deliberately closed", () => {
    expect(REQUEST_TYPES.some((o) => o.value === "other")).toBe(false);
  });
});

// The preset list and the action layer must not drift.
describe("presets match the schema they feed", () => {
  it("REQUEST_TYPES matches INTAKE_REQUEST_TYPES exactly", () => {
    expect(REQUEST_TYPES.map((o) => o.value).sort()).toEqual([...INTAKE_REQUEST_TYPES].sort());
  });

  it("document checkboxes map onto the Phase 2 columns", () => {
    expect(documentsToColumns(["boq", "specifications"])).toEqual({
      has_boq: true,
      has_drawings: false,
      has_specs: true,
    });
  });

  it("a document with no column is still selectable without breaking the mapping", () => {
    expect(documentsToColumns(["scope_of_work"])).toEqual({
      has_boq: false,
      has_drawings: false,
      has_specs: false,
    });
  });

  it("maps nothing when nothing is selected", () => {
    expect(documentsToColumns([])).toEqual({ has_boq: false, has_drawings: false, has_specs: false });
  });
});

describe("validation", () => {
  it("requires a choice", () => {
    const r = validateSelection(LOST_REASONS, null, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorAr.length).toBeGreaterThan(0);
  });

  it("rejects an unrecognised value", () => {
    expect(validateSelection(LOST_REASONS, "made_up", "x").ok).toBe(false);
  });

  it("accepts a plain option with no note", () => {
    expect(validateSelection(LOST_REASONS, "price", null).ok).toBe(true);
  });

  it("demands a note for Other, in both languages", () => {
    const r = validateSelection(LOST_REASONS, "other", "  ");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("Other");
      expect(r.errorAr).toContain("أخرى");
    }
  });

  // A competitor loss with no name is exactly the case §20 says never to infer.
  it("demands a name when the loss is to a competitor", () => {
    expect(requiresNote(LOST_REASONS, "competitor")).toBe(true);
    expect(validateSelection(LOST_REASONS, "competitor", null).ok).toBe(false);
    expect(validateSelection(LOST_REASONS, "competitor", "Acme Signs").ok).toBe(true);
  });

  it("validates a multi-select checklist", () => {
    expect(validateMultiSelection(MISSING_INFORMATION, ["boq", "drawings"], null).ok).toBe(true);
    expect(validateMultiSelection(MISSING_INFORMATION, ["boq", "other"], null).ok).toBe(false);
    expect(validateMultiSelection(MISSING_INFORMATION, ["boq", "other"], "site access").ok).toBe(true);
    expect(validateMultiSelection(MISSING_INFORMATION, ["nope"], null).ok).toBe(false);
  });

  it("accepts an empty checklist — nothing missing is a valid answer", () => {
    expect(validateMultiSelection(MISSING_INFORMATION, [], null).ok).toBe(true);
  });
});

describe("opportunity update presets", () => {
  it("every preset is bilingual in label, note and next action", () => {
    for (const p of UPDATE_PRESETS) {
      expect(p.en.trim()).not.toBe("");
      expect(p.ar.trim()).not.toBe("");
      expect(p.noteEn.trim()).not.toBe("");
      expect(p.noteAr.trim()).not.toBe("");
      if (p.nextActionEn) expect(p.nextActionAr).not.toBeNull();
    }
  });

  it("prefills the note and next action in the chosen language", () => {
    const en = applyUpdatePreset("boq_received", "en")!;
    expect(en.note).toContain("BOQ received");
    expect(en.nextAction).toContain("pricing");

    const ar = applyUpdatePreset("boq_received", "ar")!;
    expect(ar.note).toContain("جدول الكميات");
  });

  it("returns null for an unknown preset", () => {
    expect(applyUpdatePreset("nope", "en")).toBeNull();
  });

  it("marks the presets that mean contact actually happened", () => {
    expect(applyUpdatePreset("client_contacted", "en")!.logsContact).toBe(true);
    expect(applyUpdatePreset("boq_received", "en")!.logsContact).toBe(false);
  });

  // A preset must never move a stage on its own — that would route around the
  // Phase 3 transition map and its evidence gates.
  it("only ever suggests a stage, never applies one", () => {
    const bafo = applyUpdatePreset("bafo_requested", "en")!;
    expect(bafo.suggestedStage).toBe("jih_bafo");

    const plain = applyUpdatePreset("follow_up_sent", "en")!;
    expect(plain.suggestedStage).toBeNull();
  });

  it("every suggested stage is a real canonical stage", () => {
    const canonical = new Set([
      "rfq_received", "jih", "jih_bafo", "under_negotiation", "verbally_awarded",
      "contract_received", "contract_signed", "won", "lost", "on_hold",
    ]);
    for (const p of UPDATE_PRESETS) {
      if (p.suggestedStage) expect(canonical.has(p.suggestedStage)).toBe(true);
    }
  });

  it("no preset suggests won or lost — those need evidence, not a shortcut", () => {
    for (const p of UPDATE_PRESETS) {
      expect(p.suggestedStage).not.toBe("won");
      expect(p.suggestedStage).not.toBe("lost");
    }
  });

  it("has no duplicate preset values", () => {
    expect(new Set(UPDATE_PRESETS.map((p) => p.value)).size).toBe(UPDATE_PRESETS.length);
  });
});
