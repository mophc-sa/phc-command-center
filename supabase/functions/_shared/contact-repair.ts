// =============================================================================
// Reading a contact back out of the field the importer crushed it into.
//
// WHAT THE DATA ACTUALLY LOOKS LIKE
// ---------------------------------
// Measured across all 33 production contacts, not sampled:
//
//   5 of 33   have a name that is a name
//   21        carry an email address inside `name`
//   19        carry a phone number inside `name`
//   6         contain U+FFFD, where a separator was lost to an encoding fault
//   1         has `title` filled; 0 have a website or a confidence score
//
//   name: "Ahmad Ismail,Property�Management�DirectorMob +966 500778959"
//   name: "MAS ECC | Hesham Alihesham@masecc.comInfo@masecc.com"
//
// The `email` column is damaged too, which matters more than the name: those
// addresses BOUNCE. A word from the surrounding text is glued to the front of
// the local part, or a fragment trails the TLD:
//
//   "Iconh.albawab@saudi-icon.com"   ← "Icon", from the company "Saudi Icon"
//   "RiyadhNestor.Mindoro@ihg.com"   ← "Riyadh", from the name
//   "2218aaltahir@osoolre.com"       ← "2218", from "Ext: 2218"
//   "nedal@alsaad.com.saT"           ← "T", from "T: +966 12 6830306"
//
// THE RULE THIS MODULE OBEYS
// --------------------------
// Propose only what the record itself proves. A prefix is junk when the SAME
// text appears in the contact's name or company — that is evidence, not a
// guess. Leading digits are junk because a local part cannot begin with the
// extension number that preceded it. Everything else is left alone and
// reported as needing eyes.
//
// Nothing here writes. It returns proposals; a person decides. That is the
// same draft/confirm shape ai-drafts.ts uses, for the same reason: a wrong
// confident repair is worse than the damage, because the damage is visible.
// =============================================================================

/** A single thing we noticed, in the record's own words. */
export type RepairFinding =
  | { kind: "email_prefix_stripped"; removed: string; because: string }
  | { kind: "email_suffix_stripped"; removed: string }
  | { kind: "email_recovered_from_name"; value: string }
  | { kind: "phone_recovered_from_name"; value: string }
  | { kind: "title_recovered_from_name"; value: string }
  | { kind: "encoding_damage"; count: number }
  | { kind: "name_shortened"; from: number; to: number }
  | { kind: "email_still_suspect"; why: string }
  | { kind: "name_not_splittable"; why: string };

export type ContactRow = {
  id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  companyName?: string | null;
};

export type ContactRepair = {
  id: string;
  current: { name: string; title: string | null; email: string | null; phone: string | null };
  /** Only the fields we would change. An empty object means: leave this row alone. */
  proposed: { name?: string; title?: string; email?: string; phone?: string };
  findings: RepairFinding[];
  /**
   * "high"  — every proposal is backed by text found elsewhere in the record.
   * "low"   — something is off that a person should look at before saving.
   * "none"  — nothing to change.
   */
  confidence: "high" | "low" | "none";
};

/** U+FFFD. Six records carry it where a separator used to be. */
const REPLACEMENT = /�/g;

/** Words that are roles or departments, not names. Used only to LABEL, never to invent. */
const ROLE_WORDS = [
  "procurement", "purchasing", "tendering", "tender", "estimation", "material",
  "supply chain", "design head", "civil engineer", "civil engr", "engineer", "engr",
  "manager", "director", "head", "lead", "secretary", "department", "dept", "office",
  "customer service", "bid section",
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/** A local part cannot start with the extension digits that preceded it. */
const LEADING_DIGITS = /^\d+/;

/**
 * Tokens the record itself supplies: words from the name and the company.
 * These are the only things allowed to justify stripping an email prefix.
 */
function evidenceTokens(row: ContactRow): string[] {
  const raw = `${row.name ?? ""} ${row.companyName ?? ""}`.replace(REPLACEMENT, " ");

  // Remove only "@domain", never the whole address. The glued word is part of
  // the LOCAL part — strip the address entirely and the evidence for the strip
  // vanishes with it, which is why "Icon" and "Riyadh" survived the first pass.
  const withoutDomains = raw.replace(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ");

  // The domain is evidence in its own right, and often the strongest: the junk
  // prefix is usually the company, and the company is in the address.
  // "saudi-icon.com" proves "Icon"; "mrtc.com.sa" proves "MRTC".
  const domains = [...raw.matchAll(/@([A-Za-z0-9.-]+)\.[A-Za-z]{2,}/g)]
    .flatMap((m) => m[1].split(/[.\-]/));

  const words = [...withoutDomains.split(/[^A-Za-z]+/), ...domains];

  // Words the importer ran together carry a case boundary where the join
  // happened: "RiyadhNestor" is two words wearing one coat.
  const split = words.flatMap((w) =>
    w
      .replace(/([a-z\d])([A-Z])/g, "$1\u0000$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1\u0000$2")
      .split("\u0000"),
  );

  const roles = ROLE_WORDS.filter((w) => !w.includes(" "));
  const all = [...new Set([...words, ...split, ...domains, ...roles])]
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);

  const isDomain = new Set(domains.map((d) => d.toLowerCase()));

  // SHORTEST first, and a domain token ahead of anything else at equal length.
  //
  // Longest-first was wrong and quietly over-cut: for "Iconh.albawab" the name
  // text supplies "Iconh" (5) as well as the domain's "Icon" (4), and taking
  // the longer one produced "albawab@saudi-icon.com" — a plausible address
  // that is not this person's. The shortest justified strip leaves the most of
  // the local part intact, which is the conservative direction.
  return all.sort((a, b) => {
    const da = isDomain.has(a.toLowerCase()) ? 0 : 1;
    const db = isDomain.has(b.toLowerCase()) ? 0 : 1;
    return da - db || a.length - b.length;
  });
}

/** Strip trailing text that follows a complete TLD, e.g. "…com.saT" or "…comInfo". */
function stripEmailSuffix(email: string): { value: string; removed: string | null } {
  // Match the longest address that ends at a plausible TLD boundary.
  // Lowercase TLD on purpose: "nedal@alsaad.com.saT" must end at ".sa" and
  // hand back "T", the start of "T: +966 12 6830306". A case-insensitive class
  // matches "saT" as a three-letter TLD and the junk disappears into the
  // address — which is exactly the bug that shipped this data.
  const m = email.match(/^([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,10}(?:\.[a-z]{2})?)(.*)$/);
  if (!m) return { value: email, removed: null };
  const [, kept, rest] = m;
  if (!rest || rest.trim() === "") return { value: kept, removed: null };
  // Only strip letters — a second address or a real subdomain is not junk we understand.
  if (!/^[A-Za-z]+$/.test(rest)) return { value: kept, removed: rest };
  return { value: kept, removed: rest };
}

/**
 * Repair one email, using only evidence from the same record.
 * Returns null when nothing defensible can be proposed.
 */
export function repairEmail(
  raw: string,
  row: ContactRow,
): { value: string; findings: RepairFinding[] } | null {
  const findings: RepairFinding[] = [];
  let email = raw.trim();

  const suffix = stripEmailSuffix(email);
  if (suffix.removed) {
    email = suffix.value;
    findings.push({ kind: "email_suffix_stripped", removed: suffix.removed });
  }

  const at = email.indexOf("@");
  if (at <= 0) return null;
  let local = email.slice(0, at);
  const domain = email.slice(at);

  const digits = local.match(LEADING_DIGITS)?.[0];
  if (digits && digits.length < local.length) {
    local = local.slice(digits.length);
    findings.push({
      kind: "email_prefix_stripped",
      removed: digits,
      because: "a local part cannot begin with the extension digits that preceded it",
    });
  }

  for (const token of evidenceTokens(row)) {
    if (local.length <= token.length) continue;
    if (local.toLowerCase().startsWith(token.toLowerCase())) {
      // The junk was GLUED ON, so the character after it is a letter. When a
      // separator follows instead, the prefix is the address's own first
      // component and must be left alone.
      //
      //   "RiyadhNestor.Mindoro"  → after "Riyadh" comes "N": glued, strip.
      //   "Nestor.Mindoro"        → after "Nestor" comes ".": that is this
      //                             person's first name in a normal
      //                             first.last address. Stripping it produced
      //                             "Mindoro@ihg.com" — a plausible address
      //                             belonging to nobody.
      //
      // Idempotence surfaced this: repairing an already-repaired row proposed
      // a second cut. A rule that keeps cutting was never a rule about junk.
      const next = local[token.length] ?? "";
      if (!/[A-Za-z]/.test(next)) continue;
      const rest = local.slice(token.length).replace(/^[._-]+/, "");
      if (rest.length < 2) continue;
      local = local.slice(token.length);
      findings.push({
        kind: "email_prefix_stripped",
        removed: token,
        because: `"${token}" also appears in this contact's name or company`,
      });
      break; // one justified strip; more would be guessing
    }
  }

  local = local.replace(/^[._-]+/, "");
  if (local === "") return null;

  const value = `${local}${domain}`;
  if (value === raw.trim()) return null;
  return { value, findings };
}

/** Everything that is not an email, a phone, or punctuation debris. */
function stripKnownNoise(text: string): string {
  return text
    .replace(REPLACEMENT, " ")
    .replace(EMAIL_RE, " ")
    // Word-bounded, and the single letters must carry their colon. Without
    // that, /t|e/ matched inside ordinary words: "Bassem Kallas" became
    // "Bass m Kallas" and "Hesham" became "H sham".
    .replace(/\b(?:tel|mob|cont|contact|call|toll\s+free|fax)\b\s*[:.]?\s*/gi, " ")
    .replace(/\b[TEM]\s*:\s*/g, " ")
    .replace(/ext\s*[:.]?\s*\d+/gi, " ")
    .replace(/\+?\d[\d\s()\-]{6,}\d/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Split a crushed `name` into a person's name and their title.
 *
 * Deliberately conservative: it proposes a title only when a role word is
 * present, and a name only when what precedes that role word looks like one.
 * When it cannot tell, it says so rather than cutting the string somewhere
 * plausible — a half-right name is harder to spot than an obviously broken one.
 */
/**
 * Does this read as a person's name?
 *
 * Must begin with a letter and carry at least three. Without both, the
 * splitter offered ".t" — the tail of a truncated domain — as a contact.
 */
function isNameShaped(v: string): boolean {
  const letters = (v.match(/\p{L}/gu) ?? []).length;
  return /^\p{L}/u.test(v) && letters >= 3 && /^[\p{L}\p{M}'.\- ]{2,60}$/u.test(v);
}

export function splitNameAndTitle(rawName: string): {
  name: string | null;
  title: string | null;
  why: string | null;
} {
  const cleaned = stripKnownNoise(rawName);
  if (cleaned === "") return { name: null, title: null, why: "nothing left after removing contacts" };

  // A leading "Company | " or "Company - " prefix: the person follows the bar.
  const bar = cleaned.match(/^(.{2,40}?)\s*[|]\s*(.+)$/);
  const body = bar ? bar[2].trim() : cleaned;

  // "Ahmad Ismail,Property Management Director" — the comma IS the boundary,
  // and it is a stronger signal than any word list. Only trusted when what
  // precedes it reads as a name, so "Riyadh, K.S.A" cannot become a person.
  const comma = body.indexOf(",");
  if (comma > 0) {
    const head = body.slice(0, comma).trim();
    const tail = body.slice(comma + 1).trim();
    // …and only when the head carries no role word of its own. Without this,
    // "Hussam AlbawabProcurement Engr., Saudi Icon" cuts at the wrong comma
    // and offers "Hussam AlbawabProcurement Engr." as a person's name.
    const headHasRole = ROLE_WORDS.some((w) => head.toLowerCase().includes(w));
    if (isNameShaped(head) && tail !== "" && !headHasRole) {
      return { name: head, title: tail, why: null };
    }
  }

  const lower = body.toLowerCase();
  let cut = -1;
  let matched = "";
  for (const w of ROLE_WORDS) {
    const at = lower.indexOf(w);
    if (at > 0 && (cut === -1 || at < cut)) {
      cut = at;
      matched = w;
    }
  }

  if (cut === -1) {
    const words = body.split(/\s+/).filter(Boolean);
    const candidate = body.replace(/[,.\s]+$/, "");
    if (words.length >= 1 && words.length <= 4 && isNameShaped(candidate)) {
      return { name: candidate, title: null, why: null };
    }
    return { name: null, title: null, why: "no role word, and what remains is not name-shaped" };
  }

  if (body.includes("@")) {
    // An address fragment survived the cleanup, so the string is not a clean
    // "person then role". Cutting it anywhere would invent a name.
    return { name: null, title: null, why: "an email fragment remains — shape not trustworthy" };
  }

  const namePart = body.slice(0, cut).replace(/[,|\-\s]+$/, "").trim();
  const titlePart = body.slice(cut).replace(/[,|\-\s]+$/, "").trim();

  // "Procurement Dept …" cuts at "dept" and leaves "Procurement" — a role, not
  // a person. Naming nobody is correct here; naming the department is not.
  const firstWord = namePart.toLowerCase().split(/\s+/)[0] ?? "";
  if (ROLE_WORDS.some((w) => firstWord === w || namePart.toLowerCase() === w)) {
    return { name: null, title: (namePart + " " + titlePart).trim() || null,
             why: "starts with a role — no person named" };
  }

  if (namePart === "") {
    // e.g. "Procurement Dept" — a department, not a person. Title only.
    return { name: null, title: titlePart || null, why: "starts with a role — no person named" };
  }
  // A name starts with a letter and has at least three of them. Without this
  // the splitter offered ".t" (from "Radisson Collection | Procurementi…") and
  // "Purchasng" — a typo of a department — as people.
  if (!isNameShaped(namePart)) {
    return { name: null, title: titlePart || null, why: `"${namePart}" is not name-shaped` };
  }
  // A single word that is a role or department is not a person, however
  // name-shaped it looks.
  if (!namePart.includes(" ") && ROLE_WORDS.some((w) => namePart.toLowerCase().startsWith(w.slice(0, 6)))) {
    return { name: null, title: (namePart + " " + titlePart).trim() || null,
             why: `"${namePart}" reads as a department, not a person` };
  }
  void matched;
  return { name: namePart, title: titlePart || null, why: null };
}

/**
 * Tidy a title that survived the split.
 *
 * The raw cut leaves debris — "Procurement CENOMI K.S.A. .", "Estimation Unit
 * HeadCivil EngineerE: :". Writing that is not a repair; it just moves the
 * cleanup to a person later, which is the opposite of the point. Trailing
 * punctuation and orphaned label colons go; a title that shrinks below three
 * letters was never a title.
 */
export function tidyTitle(v: string): string | null {
  const out = v
    .replace(/\s*[:.,;|\-]+\s*$/g, "")
    .replace(/\s+[A-Z]\s*:\s*/g, " ")
    .replace(/\s*:\s*$/g, "")
    // "…EngineerE:" leaves an orphaned label letter glued to the last word.
    // A lone capital after a lowercase run at the very end is that letter,
    // never part of the title.
    .replace(/([a-z])[A-Z]$/, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  const letters = (out.match(/\p{L}/gu) ?? []).length;
  return letters >= 3 ? out : null;
}

/** Build the proposal for one contact. Writes nothing. */
export function repairContact(row: ContactRow): ContactRepair {
  const findings: RepairFinding[] = [];
  const proposed: ContactRepair["proposed"] = {};
  const name = row.name ?? "";

  const damage = (name.match(REPLACEMENT) ?? []).length;
  if (damage > 0) findings.push({ kind: "encoding_damage", count: damage });

  // ---- email ----
  if (row.email) {
    const fixed = repairEmail(row.email, row);
    if (fixed) {
      proposed.email = fixed.value;
      findings.push(...fixed.findings);
    }
  } else {
    const found = name.match(EMAIL_RE)?.[0];
    if (found) {
      // Pass the row UNCHANGED. Blanking the address out of the name also
      // removes its domain, and the domain is the strongest evidence for the
      // glued prefix: "mrtc.com.sa" is what proves the "MRTC" in
      // "MRTCjaseem@". The self-match guard below already stops a token from
      // stripping itself.
      const fixed = repairEmail(found, row);
      const value = fixed ? fixed.value : found;
      proposed.email = value;
      findings.push({ kind: "email_recovered_from_name", value });
      if (fixed) findings.push(...fixed.findings);
    }
  }

  // ---- phone: only when the column is empty; the importer got 24 of these right ----
  if (!row.phone) {
    const found = name.replace(EMAIL_RE, " ").match(/\+?\d[\d\s()\-]{6,}\d/)?.[0];
    if (found) {
      const value = found.replace(/[^\d+]/g, "");
      proposed.phone = value;
      findings.push({ kind: "phone_recovered_from_name", value });
    }
  }

  // ---- name and title ----
  const split = splitNameAndTitle(name);
  if (split.name && split.name !== name) {
    proposed.name = split.name;
    findings.push({ kind: "name_shortened", from: name.length, to: split.name.length });
  }
  if (split.title && !row.title) {
    const tidy = tidyTitle(split.title);
    if (tidy) {
      proposed.title = tidy;
      findings.push({ kind: "title_recovered_from_name", value: tidy });
    }
  }
  if (!split.name && name.length > 40) {
    findings.push({ kind: "name_not_splittable", why: split.why ?? "unrecognised shape" });
  }

  // ---- how much should a person trust this? ----
  const suspect =
    findings.some((f) => f.kind === "name_not_splittable" || f.kind === "email_still_suspect") ||
    (damage > 0 && !proposed.name);

  const confidence: ContactRepair["confidence"] =
    Object.keys(proposed).length === 0 ? "none" : suspect ? "low" : "high";

  return {
    id: row.id,
    current: { name, title: row.title, email: row.email, phone: row.phone },
    proposed,
    findings,
    confidence,
  };
}

/** Repair a whole book. Order preserved; rows needing nothing are still returned. */
export function repairContacts(rows: ContactRow[]): ContactRepair[] {
  return rows.map(repairContact);
}

export function repairSummary(repairs: ContactRepair[]) {
  return {
    total: repairs.length,
    high: repairs.filter((r) => r.confidence === "high").length,
    low: repairs.filter((r) => r.confidence === "low").length,
    none: repairs.filter((r) => r.confidence === "none").length,
    emails: repairs.filter((r) => r.proposed.email !== undefined).length,
    names: repairs.filter((r) => r.proposed.name !== undefined).length,
    titles: repairs.filter((r) => r.proposed.title !== undefined).length,
    phones: repairs.filter((r) => r.proposed.phone !== undefined).length,
  };
}

// =============================================================================
// PREVENTION — the same rules, applied before the row is ever written.
//
// Everything above is a cure: it reads damage that already reached the table.
// This is the other end. `commit_candidates` in import-pipeline is the single
// live write path into the CRM, and it wrote `proposed_payload` through
// untouched — which is how one `name` column came to hold a name, a title, a
// company, a phone number and an email at once, 28 times out of 33.
//
// Running the split here means those 33 review cases never exist. The import
// still writes only what the file contained: nothing is invented, values are
// moved into the column they belong in, and a field the file already mapped
// explicitly is never overwritten by something guessed out of the name.
// =============================================================================

/**
 * Split a contact payload before insert.
 *
 * Conservative by construction:
 *  - a column the mapping already filled is left exactly as it is
 *  - `name` is only shortened when the split is confident
 *  - anything unclear is written as it arrived, and the repair screen can
 *    still reach it later
 *
 * Returns the payload plus a note of what moved, so the importer can record it.
 */
export function normalizeContactPayload(
  payload: Record<string, unknown>,
  companyName?: string | null,
): { payload: Record<string, unknown>; moved: string[] } {
  const name = typeof payload.name === "string" ? payload.name : "";
  if (name.trim() === "") return { payload, moved: [] };

  const repair = repairContact({
    id: "import",
    name,
    title: typeof payload.title === "string" ? payload.title : null,
    email: typeof payload.email === "string" ? payload.email : null,
    phone: typeof payload.phone === "string" ? payload.phone : null,
    companyName: companyName ?? null,
  });

  const out = { ...payload };
  const moved: string[] = [];

  // An address the file supplied is repaired; one found inside the name is
  // recovered. Either way it lands in `email`, never left glued to a name.
  if (repair.proposed.email !== undefined) {
    out.email = repair.proposed.email;
    moved.push("email");
  }
  if (repair.proposed.phone !== undefined && !payload.phone) {
    out.phone = repair.proposed.phone;
    moved.push("phone");
  }
  if (repair.proposed.title !== undefined && !payload.title) {
    out.title = repair.proposed.title;
    moved.push("title");
  }
  // The name is the one field the file definitely meant to fill, so it is only
  // rewritten where the parser is confident. A low-confidence row keeps the
  // original string — visibly messy beats quietly wrong.
  if (repair.proposed.name !== undefined && repair.confidence === "high") {
    out.name = repair.proposed.name;
    moved.push("name");
  }

  return { payload: out, moved };
}
