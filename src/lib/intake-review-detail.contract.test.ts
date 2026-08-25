// =============================================================================
// The review queue has to show what the decision turns on.
//
// "Approve for Pricing" creates an opportunity and hands the file to
// Commercial. The queue offered that decision on four fields — project,
// company, request type, deadline — out of the fifty-five inbox_items carries.
//
// The sharpest symptom: has_boq, has_drawings and has_specs were already in
// the SELECT and were never rendered anywhere. "No BOQ" is the most common
// reason a request is not ready to price, and it was being fetched and thrown
// away. So these tests check the two halves together — fetched AND displayed —
// because either alone was already true when the gap existed.
// =============================================================================

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const panel = read("src/components/phc/IntakeReviewPanel.tsx");
const i18n = read("src/lib/i18n.tsx");

/** Source minus comment lines — the prose here names the old behaviour. */
const code = (s: string) =>
  s.split("\n").filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  }).join("\n");

const body = code(panel);
const select = body.match(/\.select\(\s*([\s\S]*?)\)\s*\n/)?.[1] ?? "";
const detail = body.match(/function IntakeDetail[\s\S]*?\n}/)?.[0] ?? "";

describe("a reviewer can open a request without leaving the queue", () => {
  it("the project cell is a disclosure control", () => {
    // Before this it was a plain div — no link, no handler, nothing. Not a
    // broken link; navigation was never written.
    expect(body).toContain("setExpanded");
    expect(body).toMatch(/aria-expanded=\{expanded === r\.id\}/);
    expect(body).toMatch(/aria-controls=\{`intake-detail-\$\{r\.id\}`\}/);
  });

  it("expands in place rather than navigating away", () => {
    // A review queue is worked top to bottom. Routing out and back for each of
    // ten requests loses the reviewer's place every time.
    expect(body).not.toMatch(/navigate\(|<Link\b/);
    expect(body).toContain("<IntakeDetail r={r} />");
  });

  it("only one row is open at a time", () => {
    expect(body).toMatch(/setExpanded\(expanded === r\.id \? null : r\.id\)/);
  });

  it("the detail row spans the table", () => {
    expect(body).toContain("colSpan={5}");
  });

  it("keys the pair on a Fragment, not the inner rows", () => {
    // Two sibling <tr>s per record; keying the wrong element remounts the open
    // row on every refetch and collapses it under the reviewer.
    expect(body).toMatch(/<Fragment key=\{r\.id\}>/);
  });
});

describe("the documents question is answerable — the field that was fetched and dropped", () => {
  for (const f of ["has_boq", "has_drawings", "has_specs"]) {
    it(`${f} is both fetched and rendered`, () => {
      expect(select, `${f} not selected`).toContain(f);
      expect(detail, `${f} fetched but never shown`).toContain(f);
    });
  }

  it("renders presence/absence, not a raw boolean", () => {
    expect(detail).toContain("=== true");
    expect(detail).toContain("rev_details_no_docs");
  });
});

describe("every field the decision turns on is fetched and shown", () => {
  const DECISION_FIELDS = [
    "scope", "estimated_value", "contact_name", "email", "phone",
    "main_contractor", "consultant", "location_city", "notes",
    "evidence_url", "client_rfq_reference", "internal_rfq_reference",
    "project_number", "date_received", "source_name",
  ];

  for (const f of DECISION_FIELDS) {
    it(`${f} reaches the reviewer`, () => {
      expect(select, `${f} missing from the query`).toContain(f);
      expect(detail, `${f} fetched but not rendered`).toContain(f);
    });
  }

  it("fetches nothing it does not use", () => {
    // The inverse of the original bug, and it earned its keep immediately:
    // first run it flagged six columns pulled and dropped — three I had just
    // added without rendering (scope_type, client_type, project_type) and two
    // that predated this change (info_due_date, reject_reason). All were
    // fixed rather than exempted; reject_reason was deleted from the query
    // because this queue filters to pending_review/need_information, where it
    // is always null.
    //
    // `created_at` is the one legitimate exemption: it drives .order(), not
    // display.
    const ORDER_ONLY = new Set(["id", "created_at"]);
    const fetched = select.replace(/["'+\s]/g, "").split(",").filter(Boolean);
    const unused = fetched.filter((f) => !ORDER_ONLY.has(f) && !body.includes(`r.${f}`));
    expect(unused, `selected but never read: ${unused.join(", ")}`).toEqual([]);
  });

  it("orders by the column it selects for ordering", () => {
    expect(body).toContain('.order("created_at"');
  });

  it("does not fetch reject_reason, which is always null in this queue", () => {
    // The query filters to pending_review / need_information. A rejected item
    // is not here, so the column can only ever come back empty.
    expect(select).not.toContain("reject_reason");
    expect(body).toMatch(/\.in\("review_state", \["pending_review", "need_information"\]\)/);
  });
});

describe("an empty field is visible, not hidden", () => {
  it("renders a placeholder instead of omitting the row", () => {
    // A blank Scope is itself grounds to send a request back. Hiding it makes
    // the gap invisible exactly when someone is judging completeness.
    expect(detail).toContain("rev_details_none");
    expect(detail).toMatch(/String\(value\)\.trim\(\) === ""/);
  });

  it("marks an empty value visually as well as textually", () => {
    expect(detail).toContain("italic");
  });
});

describe("bilingual and RTL, like the rest of the system", () => {
  const KEYS = [
    "rev_show_details", "rev_hide_details", "rev_details_scope",
    "rev_details_docs", "rev_details_parties", "rev_details_origin",
    "rev_details_none", "rev_details_no_docs",
    "ibx_notes", "ibx_main_contractor", "ibx_email", "ibx_phone",
  ];

  for (const k of KEYS) {
    it(`${k} has both languages`, () => {
      const line = i18n.split("\n").find((l) => l.trim().startsWith(`${k}:`));
      expect(line, `${k} missing from i18n`).toBeDefined();
      expect(line).toContain('en: "');
      expect(line).toMatch(/ar: "[^"]*[؀-ۿ]/);
    });
  }

  it("no hardcoded English in the detail component", () => {
    // Every visible string goes through t(); the only quoted literals left
    // should be class names and the em-dash fallback.
    const visible = detail.match(/>\s*[A-Z][a-z]{3,}/g) ?? [];
    expect(visible).toEqual([]);
  });

  it("the chevron mirrors under RTL", () => {
    expect(detail.length + body.length).toBeGreaterThan(0);
    expect(body).toContain("rtl:-scale-x-100");
  });

  it("uses logical spacing properties throughout the detail", () => {
    expect(detail).not.toMatch(/\b(ml-|mr-|pl-|pr-|text-left|text-right)\b/);
  });
});

describe("read-only — the detail changes nothing", () => {
  it("performs no write of any kind", () => {
    expect(detail).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(|supabase/);
  });

  it("the four decisions remain the only actions", () => {
    for (const a of ["approveIntakeForPricing", "requestIntakeInformation", "monitorIntake", "rejectIntake"]) {
      expect(body).toContain(a);
    }
  });
});
