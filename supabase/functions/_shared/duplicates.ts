// =============================================================================
// PHC Sales OS — Duplicate Detection Engine (pure, real-data, unit-testable).
//
// Groups records that are likely the same entity and EXPLAINS why: which
// normalized fields matched and a confidence score. It only recommends merges —
// it never merges automatically.
// =============================================================================

import { normalizeCompanyName } from "./company-normalize.ts";

export type DupRecord = {
  id: string;
  name?: string | null;
  website_domain?: string | null;
  cr_number?: string | null;
  phone?: string | null;
  email?: string | null;
  project_name?: string | null;
  contractor_name?: string | null;
};

export type DuplicateGroup = {
  entity_type: string;
  matched_fields: string[];
  match_reason: string;
  confidence: number; // 0..1
  members: { entity_id: string; display_label: string }[];
};

export function normalizeDomain(v: string | null | undefined): string {
  if (!v) return "";
  let s = String(v).toLowerCase().trim();
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0];
  // treat an email as its domain
  if (s.includes("@")) s = s.split("@")[1] ?? "";
  return s;
}

export function normalizePhone(v: string | null | undefined): string {
  if (!v) return "";
  const digits = String(v).replace(/\D/g, "");
  return digits.length > 9 ? digits.slice(-9) : digits; // ignore country prefix
}

export function normalizeEmail(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).toLowerCase().trim();
}

export function normalizeCr(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).replace(/\D/g, "");
}

// Field -> confidence weight when it is the reason two records grouped.
const FIELD_WEIGHT: Record<string, number> = {
  cr_number: 0.98,
  website_domain: 0.9,
  email: 0.9,
  phone: 0.8,
  name: 0.65,
  project_name: 0.65,
  contractor_name: 0.6,
};

type Signal = { field: string; value: string };

function signalsOf(r: DupRecord): Signal[] {
  const out: Signal[] = [];
  const push = (field: string, value: string) => {
    if (value) out.push({ field, value });
  };
  push("name", normalizeCompanyName(r.name));
  push("website_domain", normalizeDomain(r.website_domain));
  push("cr_number", normalizeCr(r.cr_number));
  push("phone", normalizePhone(r.phone));
  push("email", normalizeEmail(r.email));
  push("project_name", normalizeCompanyName(r.project_name));
  push("contractor_name", normalizeCompanyName(r.contractor_name));
  return out;
}

// Union-find over records that share any normalized signal value.
export function findDuplicateGroups(records: DupRecord[], entityType = "company"): DuplicateGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) {
      const p = parent.get(r)!;
      parent.set(r, parent.get(p)!);
      r = parent.get(r)!;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const r of records) parent.set(r.id, r.id);

  // key = field|value -> list of record ids that carry it
  const buckets = new Map<string, string[]>();
  const recSignals = new Map<string, Signal[]>();
  for (const r of records) {
    const sigs = signalsOf(r);
    recSignals.set(r.id, sigs);
    for (const s of sigs) {
      const key = `${s.field}|${s.value}`;
      const arr = buckets.get(key) ?? [];
      arr.push(r.id);
      buckets.set(key, arr);
    }
  }
  for (const [, ids] of buckets) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // Collect components with > 1 member.
  const comps = new Map<string, string[]>();
  for (const r of records) {
    const root = find(r.id);
    const arr = comps.get(root) ?? [];
    arr.push(r.id);
    comps.set(root, arr);
  }
  const byId = new Map(records.map((r) => [r.id, r]));

  const groups: DuplicateGroup[] = [];
  for (const [, ids] of comps) {
    if (ids.length < 2) continue;
    // Which fields actually match across >= 2 members?
    const matched = new Set<string>();
    const fieldValueCount = new Map<string, Map<string, number>>();
    for (const id of ids) {
      for (const s of recSignals.get(id) ?? []) {
        const m = fieldValueCount.get(s.field) ?? new Map<string, number>();
        m.set(s.value, (m.get(s.value) ?? 0) + 1);
        fieldValueCount.set(s.field, m);
      }
    }
    for (const [field, values] of fieldValueCount) {
      for (const [, count] of values) if (count >= 2) matched.add(field);
    }
    const matched_fields = [...matched];
    const confidence = matched_fields.length
      ? Math.min(0.99, Math.max(...matched_fields.map((f) => FIELD_WEIGHT[f] ?? 0.5)) + (matched_fields.length > 1 ? 0.03 : 0))
      : 0.5;
    groups.push({
      entity_type: entityType,
      matched_fields,
      match_reason: `Matched on ${matched_fields.join(", ") || "similar values"}`,
      confidence: Math.round(confidence * 100) / 100,
      members: ids.map((id) => ({
        entity_id: id,
        display_label: byId.get(id)?.name ?? byId.get(id)?.project_name ?? id,
      })),
    });
  }
  // Highest-confidence groups first.
  return groups.sort((a, b) => b.confidence - a.confidence);
}
