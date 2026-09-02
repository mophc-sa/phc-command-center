// =============================================================================
// The entry form's shape, from the 2026-09-02 report.
//
// These are source-structure assertions in the style of the other
// *.contract.test.ts files here: the repo has no DOM harness, and what is worth
// pinning is not how a field renders but WHICH fields exist and which rules
// they carry. Every one of them below was a specific request.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { readSource } from "@/lib/source-under-test";
import {
  INBOX_CLIENT_TYPES,
  INBOX_CLIENT_TYPES_LEGACY,
  INBOX_LOCATIONS,
  INBOX_RFQ_FROM,
  INBOX_SCOPES,
  INBOX_SOURCE_TYPES,
} from "@/lib/inbox-actions";

const { code: FORM } = readSource(
  join(import.meta.dir, "..", "components", "phc", "NewIntakeDialog.tsx"),
);
const { code: DIALOG } = readSource(
  join(import.meta.dir, "..", "components", "phc", "ActionDialog.tsx"),
);

describe("the lists match the business", () => {
  it("offers the four client types asked for, plus an escape", () => {
    expect(INBOX_CLIENT_TYPES).toEqual([
      "main_contractor", "subcontractor", "owner", "consultant", "other",
    ]);
  });

  it("stops offering the track labels, without deleting them", () => {
    // contractor_jih / contractor_tender describe which TRACK the work is on,
    // which the request type already says. Ten live rows carry them and
    // Postgres cannot drop an enum label, so they stay readable and stop being
    // offered — re-pointing those rows is a business decision, not a migration.
    for (const legacy of ["main_client", "contractor_jih", "contractor_tender"]) {
      expect([legacy, INBOX_CLIENT_TYPES.includes(legacy as never)]).toEqual([legacy, false]);
      expect([legacy, INBOX_CLIENT_TYPES_LEGACY.includes(legacy as never)]).toEqual([legacy, true]);
    }
  });

  it("lets someone say the enquiry came by phone", () => {
    // Eight of twelve items were filed as email_placeholder because there was
    // nothing else to pick, and it is first because it is the common case.
    expect(INBOX_SOURCE_TYPES[0]).toBe("phone_call");
  });

  it("gives every closed list a way out", () => {
    // A list with no row for your answer is answered wrongly and silently.
    for (const [name, list] of [
      ["client type", INBOX_CLIENT_TYPES],
      ["RFQ from", INBOX_RFQ_FROM],
      ["scope", INBOX_SCOPES],
      ["location", INBOX_LOCATIONS],
    ] as const) {
      expect([name, list.includes("other" as never)]).toEqual([name, true]);
    }
  });
});

describe("every 'other' has somewhere to say what it was", () => {
  it("pairs each list with a required free-text field, shown only when chosen", () => {
    for (const [list, field] of [
      ["clientType", "clientTypeOther"],
      ["rfqFrom", "rfqFromOther"],
      ["scopeType", "scopeTypeOther"],
      ["locationCity", "locationOther"],
    ]) {
      expect([field, FORM.includes(`key: "${field}"`)]).toEqual([field, true]);
      expect([
        field,
        FORM.includes(`showWhen: { field: "${list}", equals: "other" }`),
      ]).toEqual([field, true]);
    }
  });

  it("uses a different string for the option and for the field's label", () => {
    // One shared key put the word "Other" on the text box, where it said
    // nothing about what to write in it.
    expect(FORM).toContain('t("ibx_client_type_specify")');
    expect(FORM).not.toContain('label: t("ibx_client_type_other")');
  });
});

describe("a hidden field cannot block the form", () => {
  it("checks visibility before requiredness", () => {
    // The free-text fields are `required`. Validating one while it is hidden
    // would refuse to save for a reason nobody can see on screen.
    const idx = DIALOG.indexOf("for (const f of fields) {");
    expect(idx).toBeGreaterThan(-1);
    expect(DIALOG.slice(idx, idx + 160)).toContain("if (!isVisible(f)) continue;");
  });

  it("renders and validates through the same predicate", () => {
    // Two copies of "is this on screen" is how they come to disagree.
    expect(DIALOG).toContain("fields.filter(isVisible)");
    expect((DIALOG.match(/const isVisible = /g) ?? []).length).toBe(1);
  });
});

describe("the two new answers the form can record", () => {
  it("asks whether the client uses the SAAB ARABIA portal", () => {
    expect(FORM).toContain('key: "saabPortal"');
  });

  it("asks how far along the project is, and treats blank as unknown", () => {
    // `Number("")` is 0, and a project at 0% has not broken ground — reading
    // one as the other puts a signage enquiry at the wrong end of the queue.
    expect(FORM).toContain('key: "completionPct"');
    expect(FORM).toContain("v.completionPct?.trim() ? Number(v.completionPct) : undefined");
  });
});

describe("what is mandatory", () => {
  it("requires the five a colleague cannot work without", () => {
    for (const key of ["companyName", "contactName", "phone", "projectName"]) {
      const at = FORM.indexOf(`key: "${key}"`);
      expect([key, at]).not.toEqual([key, -1]);
      expect([key, FORM.slice(at, at + 220).includes("required: true")]).toEqual([key, true]);
    }
  });

  it("does not require an email", () => {
    // Plenty of site contacts have a phone and no address. A required email
    // teaches people to type x@x.com, which is worse than an empty column
    // because it looks like data.
    const at = FORM.indexOf('key: "email"');
    expect(at).toBeGreaterThan(-1);
    expect(FORM.slice(at, at + 120)).not.toContain("required: true");
  });
});
