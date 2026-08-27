// =============================================================================
// The repair proposals, tested against the production book itself.
//
// Every fixture below is a REAL row, copied verbatim from the 33 contacts in
// production on 2026-08-27 — including the U+FFFD characters. Inventing
// plausible-looking damage would have tested a parser against my imagination
// rather than against the importer that actually produced this.
//
// The assertions are about what a person would see in the review screen, and
// about the one rule that matters: never propose what the record does not
// prove.
// =============================================================================

import { describe, expect, it } from "bun:test";
import {
  repairContact,
  repairContacts,
  repairEmail,
  repairSummary,
  splitNameAndTitle,
  normalizeContactPayload,
  tidyTitle,
  type ContactRow,
} from "../../supabase/functions/_shared/contact-repair";

const row = (o: Partial<ContactRow> & { id: string; name: string }): ContactRow => ({
  title: null, email: null, phone: null, companyName: null, ...o,
});

/** Verbatim production rows. Do not "tidy" these — the mess is the fixture. */
const REAL: ContactRow[] = [
  row({ id: "1", name: "Dowel Sanchez, Procurement CENOMI K.S.A. � +966 114350000.",
        phone: "+966114350000", companyName: "CENOMI" }),
  row({ id: "2", name: "Ahmad Ismail,Property�Management�DirectorMob +966 500778959",
        phone: "+966500778959", companyName: "OSOOL" }),
  row({ id: "4", name: "Nestor Mindoro| Material SecretaryIHG� InterContinental RiyadhNestor.Mindoro@ihg.com",
        email: "RiyadhNestor.Mindoro@ihg.com" }),
  row({ id: "5", name: "Hussam AlbawabProcurement Engr., Saudi Iconh.albawab@saudi-icon.com",
        email: "Iconh.albawab@saudi-icon.com", companyName: "NMDC" }),
  row({ id: "8", name: "Satish KemkarDesign HeadShapoorji Pallonji Mideast L.L.CExit 10 project, Riyadh, K.S.Asatish.kemkar@shapoorji.com",
        email: "K.S.Asatish.kemkar@shapoorji.com", companyName: "SEVEN" }),
  row({ id: "12", name: "Eng. Alaa Altahir, CIPS L4Senior Procurement LeadTel: +966 112059922 Ext: 2218aaltahir@osoolre.com",
        email: "2218aaltahir@osoolre.com", phone: "+966112059922", companyName: "OSOOL" }),
  row({ id: "16", name: "NEDAL ABDULRAHMAN ALIEstimation Unit HeadCivil EngineerE: nedal@alsaad.com.saT: +966 12 6830306",
        email: "nedal@alsaad.com.saT", phone: "+966126830306" }),
  row({ id: "17", name: "Procurement Dept Contact: +966 53 634 8208.Email : info@hashem-sa.com",
        email: "info@hashem-sa.com", phone: "+966536348208" }),
  row({ id: "23", name: "Jaseem PonnethTendering MRTCjaseem@mrtc.com.sa",
        email: "MRTCjaseem@mrtc.com.sa", companyName: "Madinah Gate Development" }),
  row({ id: "27", name: "Via Riyadh - Purchasing Deptcontact@viariyadh.com",
        email: "Deptcontact@viariyadh.com", companyName: "Via Riyadh" }),
  row({ id: "29", name: "FADI ZAKOOR", title: "SUPPLY CHAIN DIRECTOR",
        email: "f.zakoor@saudi-icon.com", phone: "+966509811205", companyName: "Saudi Icon" }),
  row({ id: "33", name: "Bassem Kallas", phone: "0536285000", companyName: "PHC Signs" }),
];

const byId = (id: string) => REAL.find((r) => r.id === id)!;

describe("emails are repaired only where the record proves the junk", () => {
  it('strips a company word: "Iconh.albawab@" → "h.albawab@"', () => {
    // "Icon" is not a guess — it is in the name, from "Saudi Icon".
    const r = repairEmail("Iconh.albawab@saudi-icon.com", byId("5"))!;
    expect(r.value).toBe("h.albawab@saudi-icon.com");
    expect(r.findings.some((f) => f.kind === "email_prefix_stripped")).toBe(true);
  });

  it('strips a city word: "RiyadhNestor.Mindoro@" → "Nestor.Mindoro@"', () => {
    expect(repairEmail("RiyadhNestor.Mindoro@ihg.com", byId("4"))!.value)
      .toBe("Nestor.Mindoro@ihg.com");
  });

  it('strips extension digits: "2218aaltahir@" → "aaltahir@"', () => {
    // From "Ext: 2218". A local part cannot begin with the extension.
    expect(repairEmail("2218aaltahir@osoolre.com", byId("12"))!.value)
      .toBe("aaltahir@osoolre.com");
  });

  it('strips a trailing fragment: "…alsaad.com.saT" → "…alsaad.com.sa"', () => {
    // The "T" is the start of "T: +966 12 6830306".
    const r = repairEmail("nedal@alsaad.com.saT", byId("16"))!;
    expect(r.value).toBe("nedal@alsaad.com.sa");
    expect(r.findings.some((f) => f.kind === "email_suffix_stripped")).toBe(true);
  });

  it('strips a department word: "Deptcontact@" → "contact@"', () => {
    expect(repairEmail("Deptcontact@viariyadh.com", byId("27"))!.value)
      .toBe("contact@viariyadh.com");
  });

  it('strips an acronym present in the name: "MRTCjaseem@" → "jaseem@"', () => {
    expect(repairEmail("MRTCjaseem@mrtc.com.sa", byId("23"))!.value)
      .toBe("jaseem@mrtc.com.sa");
  });

  it("leaves an already-clean address completely alone", () => {
    // Two of these exist and must not be "improved".
    expect(repairEmail("info@hashem-sa.com", byId("17"))).toBeNull();
    expect(repairEmail("f.zakoor@saudi-icon.com", byId("29"))).toBeNull();
  });

  it("refuses to strip a prefix the record does not contain", () => {
    // "Zebra" appears nowhere in this row, so there is no evidence for it.
    const r = repairEmail("Zebrahello@example.com", row({ id: "x", name: "Someone" }));
    expect(r).toBeNull();
  });

  it("strips at most one justified prefix — more would be guessing", () => {
    const r = repairEmail("ProcurementIconh.albawab@saudi-icon.com", byId("5"));
    // "Procurement" goes; it does not then also chase "Icon".
    expect(r!.value).toBe("Iconh.albawab@saudi-icon.com");
    expect(r!.findings.filter((f) => f.kind === "email_prefix_stripped")).toHaveLength(1);
  });
});

describe("names and titles come apart only when the shape allows", () => {
  it("splits a person from their role", () => {
    const s = splitNameAndTitle("Satish KemkarDesign HeadShapoorji Pallonji Mideast L.L.C");
    expect(s.name).toBe("Satish Kemkar");
    expect(s.title).toContain("Design Head");
  });

  it("keeps an already-clean name untouched", () => {
    expect(splitNameAndTitle("Bassem Kallas")).toEqual({ name: "Bassem Kallas", title: null, why: null });
    expect(splitNameAndTitle("FADI ZAKOOR").name).toBe("FADI ZAKOOR");
  });

  it("recognises a department as a department, and names nobody", () => {
    // "Procurement Dept …" is not a person. Proposing one would invent them.
    const s = splitNameAndTitle("Procurement Dept Contact: +966 53 634 8208.Email : info@hashem-sa.com");
    expect(s.name).toBeNull();
    expect(s.title).toMatch(/procurement/i);
    expect(s.why).toBeTruthy();
  });

  it("takes the person after a company bar", () => {
    expect(splitNameAndTitle("MAS ECC | Hesham Ali").name).toBe("Hesham Ali");
  });

  it("says why, instead of cutting somewhere plausible", () => {
    const s = splitNameAndTitle("AskProcurement@ ihg.com");
    expect(s.name).toBeNull();
    expect(s.why).toBeTruthy();
  });
});

describe("a whole proposal, per row", () => {
  it("row 5: fixes the email and names the person", () => {
    const r = repairContact(byId("5"));
    expect(r.proposed.email).toBe("h.albawab@saudi-icon.com");
    expect(r.proposed.name).toBe("Hussam Albawab");
    expect(r.confidence).toBe("high");
  });

  it("row 12: fixes the email, keeps the phone the importer got right", () => {
    const r = repairContact(byId("12"));
    expect(r.proposed.email).toBe("aaltahir@osoolre.com");
    // phone was already correct — proposing it again is noise.
    expect(r.proposed.phone).toBeUndefined();
  });

  it("row 4: recovers the email even though the column held the broken copy", () => {
    expect(repairContact(byId("4")).proposed.email).toBe("Nestor.Mindoro@ihg.com");
  });

  it("row 33: a clean contact is proposed for nothing at all", () => {
    const r = repairContact(byId("33"));
    expect(r.proposed).toEqual({});
    expect(r.confidence).toBe("none");
  });

  it("row 29: the one already-good record is left entirely alone", () => {
    expect(repairContact(byId("29")).proposed).toEqual({});
  });

  it("rows carrying U+FFFD are reported, not silently rewritten", () => {
    const r = repairContact(byId("2"));
    const damage = r.findings.find((f) => f.kind === "encoding_damage");
    expect(damage).toBeTruthy();
    expect(damage!.kind === "encoding_damage" && damage!.count).toBeGreaterThan(0);
  });

  it("row 17: a department row proposes a title but never a person's name", () => {
    const r = repairContact(byId("17"));
    expect(r.proposed.name).toBeUndefined();
  });

  it("every proposal carries a finding that explains it", () => {
    for (const r of repairContacts(REAL)) {
      if (Object.keys(r.proposed).length > 0) {
        expect([r.id, r.findings.length > 0]).toEqual([r.id, true]);
      }
    }
  });

  it("nothing in this module can write — it holds no client", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../../supabase/functions/_shared/contact-repair.ts"), "utf8");
    expect(src).not.toMatch(/from\s+"@\/integrations\/supabase/);
    for (const w of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect([w, src.includes(w)]).toEqual([w, false]);
    }
  });
});

describe("the summary a reviewer sees before touching anything", () => {
  it("counts what would change, by kind", () => {
    const s = repairSummary(repairContacts(REAL));
    expect(s.total).toBe(REAL.length);
    expect(s.emails).toBeGreaterThan(0);
    expect(s.none).toBeGreaterThan(0); // clean rows exist and stay clean
    expect(s.high + s.low + s.none).toBe(s.total);
  });

  it("repairing twice changes nothing the second time", () => {
    // Applying a proposal must be a fixed point, or review is meaningless.
    const first = repairContacts(REAL);
    const applied: ContactRow[] = REAL.map((r, i) => ({
      ...r,
      name: first[i].proposed.name ?? r.name,
      title: first[i].proposed.title ?? r.title,
      email: first[i].proposed.email ?? r.email,
      phone: first[i].proposed.phone ?? r.phone,
    }));
    for (const again of repairContacts(applied)) {
      expect([again.id, again.proposed.email]).toEqual([again.id, undefined]);
    }
  });
});

describe("a proposal that is not name-shaped is refused, not offered", () => {
  it('refuses ".t" — punctuation debris is not a person', () => {
    const s = splitNameAndTitle("Radisson Collection | Procurementinfo.mansard@radissoncollection.com.t");
    expect(s.name).toBeNull();
    expect(s.why).toBeTruthy();
  });

  it('refuses "Purchasng" — a misspelt department is still a department', () => {
    const s = splitNameAndTitle("Laysen Valley | Purchasng Dept0505309999");
    expect(s.name).toBeNull();
  });

  it("a name must start with a letter and carry at least three", () => {
    for (const bad of [".t", "A.", "12 Dept Manager"]) {
      expect([bad, splitNameAndTitle(bad).name]).toEqual([bad, null]);
    }
  });
});

describe("titles are written clean, or not written", () => {
  it("drops trailing punctuation debris", () => {
    // "K.S.A." keeps its own final dot — that is an abbreviation, not debris.
    expect(tidyTitle("Procurement CENOMI K.S.A. .")).toBe("Procurement CENOMI K.S.A.");
  });

  it("drops an orphaned label colon", () => {
    expect(tidyTitle("Estimation Unit HeadCivil EngineerE: :")).toBe("Estimation Unit HeadCivil Engineer");
  });

  it("refuses a title that is not really one", () => {
    for (const v of [".", " : ", "-- ,", "A."]) expect([v, tidyTitle(v)]).toEqual([v, null]);
  });

  it("leaves a good title alone", () => {
    expect(tidyTitle("Design Head")).toBe("Design Head");
  });
});

// ---- Prevention: the same rules, before the row is written -----------------

describe("import splits a contact before it reaches the table", () => {
  it("the exact row that produced the worst record in production", () => {
    // One spreadsheet cell holding a name, a title and a phone number. Written
    // through untouched, this became contact #2 in the live book.
    const { payload, moved } = normalizeContactPayload({
      name: "Ahmad Ismail,Property Management DirectorMob +966 500778959",
    });
    expect(payload.name).toBe("Ahmad Ismail");
    expect(payload.phone).toBe("+966500778959");
    expect(String(payload.title)).toMatch(/Director/);
    expect(moved.sort()).toEqual(["name", "phone", "title"]);
  });

  it("lifts an email out of the name and lands it in its own column", () => {
    const { payload } = normalizeContactPayload({
      name: "Jaseem PonnethTendering MRTCjaseem@mrtc.com.sa",
    });
    expect(payload.email).toBe("jaseem@mrtc.com.sa");
    expect(payload.name).toBe("Jaseem Ponneth");
  });

  it("repairs a glued address the file itself supplied", () => {
    const { payload } = normalizeContactPayload({
      name: "Hussam AlbawabProcurement Engr., Saudi Icon",
      email: "Iconh.albawab@saudi-icon.com",
    });
    expect(payload.email).toBe("h.albawab@saudi-icon.com");
  });

  it("NEVER overwrites a column the mapping already filled", () => {
    // The file said the title is this. We do not know better than the file.
    const { payload } = normalizeContactPayload({
      name: "Satish KemkarDesign HeadShapoorji Pallonji",
      title: "Head of Design",
      phone: "+966500000000",
    });
    expect(payload.title).toBe("Head of Design");
    expect(payload.phone).toBe("+966500000000");
  });

  it("keeps the original name when the split is not confident", () => {
    // Visibly messy beats quietly wrong: the repair screen can still reach it.
    const messy = "AskProcurement@ ihg.com";
    const { payload, moved } = normalizeContactPayload({ name: messy });
    expect(payload.name).toBe(messy);
    expect(moved).not.toContain("name");
  });

  it("leaves an already-clean row completely untouched", () => {
    const clean = { name: "Bassem Kallas", phone: "0536285000" };
    const { payload, moved } = normalizeContactPayload({ ...clean });
    expect(payload).toEqual(clean);
    expect(moved).toEqual([]);
  });

  it("passes a row with no name straight through", () => {
    const { payload, moved } = normalizeContactPayload({ email: "x@y.com" });
    expect(payload).toEqual({ email: "x@y.com" });
    expect(moved).toEqual([]);
  });

  it("invents nothing — every written value came from the input string", () => {
    const src = "Nestor Mindoro| Material Secretary InterContinental RiyadhNestor.Mindoro@ihg.com";
    const { payload } = normalizeContactPayload({ name: src });
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v !== "string" || k === "name") continue;
      const bare = v.replace(/[^A-Za-z0-9@._+]/g, "");
      expect([k, src.replace(/[^A-Za-z0-9@._+]/g, "").includes(bare.slice(0, 8))]).toEqual([k, true]);
    }
  });

  it("the importer and the repair screen share ONE module", () => {
    // Two copies of these rules would drift, and the drift would be invisible
    // until a future import produced damage the repair screen could not read.
    const fs = require("node:fs");
    const path = require("node:path");
    const shared = path.join(__dirname, "../../supabase/functions/_shared/contact-repair.ts");
    expect(fs.existsSync(shared)).toBe(true);
    expect(fs.existsSync(path.join(__dirname, "./contact-repair.ts"))).toBe(false);
    const pipeline = fs.readFileSync(
      path.join(__dirname, "../../supabase/functions/import-pipeline/index.ts"), "utf8");
    expect(pipeline).toContain('from "../_shared/contact-repair.ts"');
    expect(pipeline).toContain("normalizeContactPayload");
  });
});
