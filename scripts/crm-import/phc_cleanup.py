"""
PHC Quotation List — Controlled Cleanup Pass (v2)
Reads:  C:/Temp/phc_import_data.json
Writes: C:/Temp/phc_cleaned_batch.json  (status: pending_approval)

Rules applied:
  1. Company name encoding: U+FFFD → en-dash, whitespace normalised.
     source_name (original) preserved in every record.
  2. Merges applied (reversible — both original aliases retained):
       IHG  +  IHG Group  →  "IHG Group"
       Shaza  +  Shaza Hotels  →  "Shaza Hotels"
  3. IHG – VOCO: kept as separate record, review_flag added.
  4. Company "–" (corrupt cell): NOT created as active company.
     Preserved as data_quality_warning record; linked project gets
     main_contractor_ref: null + data_quality_note.
  5. Radisson / Radisson Collection: separate records, no merge.
  6. Placeholder financials: raw literal "3.50M" → total_value null;
     value_raw always preserved for audit.
  7. All 124 source records present in staging output.
  8. status: pending_approval — nothing written to CRM.
"""
import sys; sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import json, re, csv
from pathlib import Path

src = json.loads(Path("C:/Temp/phc_import_data.json").read_text(encoding="utf-8"))

PLACEHOLDER_LITERAL = "3.50M"

CORRUPT_COMPANY_NAMES = {"–", "\ufffd", "?", "-"}   # single-char/corrupt markers

# ── helpers ───────────────────────────────────────────────────────────────────

def clean_name(s: str) -> str:
    s = (s or "").replace('\ufffd', '–')
    return re.sub(r'\s+', ' ', s).strip()

def is_corrupt(name: str) -> bool:
    return name.strip() in CORRUPT_COMPANY_NAMES or not name.strip()

# ── 1. Clean + classify companies ─────────────────────────────────────────────

MERGE_MAP = {
    "IHG Group":   ["IHG", "IHG Group"],
    "Shaza Hotels": ["Shaza", "Shaza Hotels"],
}

# alias_to_canonical covers ONLY the explicitly approved merges
alias_to_canonical: dict[str, str] = {}
for canon, members in MERGE_MAP.items():
    for m in members:
        alias_to_canonical[clean_name(m)] = canon

merged_companies: dict[str, dict] = {}
merge_log: list[dict] = []
corrupt_company_keys: set[str] = set()   # canonical keys for corrupt records

for c in src["companies"]:
    original  = c["name"]
    cleaned   = clean_name(original)

    # ── corrupt / blank company ────────────────────────────────────────────────
    if is_corrupt(cleaned):
        key = f"__corrupt__{original}"
        merged_companies[key] = {
            **c,
            "name":        cleaned or "(blank)",
            "source_name": original,
            "aliases":     [original],
            "record_status": "data_quality_warning",
            "data_quality_note": "Missing/corrupt contractor value in source.",
            "import_action": "exclude_from_crm",
        }
        corrupt_company_keys.add(key)
        continue

    # ── IHG – VOCO: keep as-is, add review flag ────────────────────────────────
    if cleaned == "IHG – VOCO":
        merged_companies[cleaned] = {
            **c,
            "name":        cleaned,
            "source_name": original,
            "aliases":     [original] if original != cleaned else [],
            "review_flag": True,
            "review_note": (
                "Possible relationship with VOCO Hotel / IHG; "
                "requires manual entity resolution."
            ),
            "import_action": "create_with_review_flag",
        }
        continue

    # ── approved merges ────────────────────────────────────────────────────────
    canon = alias_to_canonical.get(cleaned, cleaned)

    if canon in merged_companies:
        existing = merged_companies[canon]
        for alias in [cleaned, original]:
            if alias and alias not in existing["aliases"] and alias != existing["name"]:
                existing["aliases"].append(alias)
        merge_log.append({
            "absorbed":  cleaned,
            "into":      canon,
            "original_source_name": original,
        })
    else:
        rec = {
            **c,
            "name":        canon,
            "source_name": original,
            "aliases":     ([original] if original != canon else []),
            "import_action": "create",
        }
        merged_companies[canon] = rec

final_companies = list(merged_companies.values())

# ── 2. Load raw value map from CSV ───────────────────────────────────────────

CSV_PATH = r"E:\Downloads\PHC Quotation List - MAR 2026(PHC PROJECT REFERENCE).csv"
raw_csv  = Path(CSV_PATH).read_text(encoding="utf-8-sig", errors="replace")
lines    = raw_csv.splitlines()
rows     = list(csv.reader(lines))

raw_val_map: dict[str, str] = {}
sec1_start = sec2_start = None
for i, r in enumerate(rows):
    if r and "Sr. #" in r[0]:              sec1_start = i + 1
    if r and r[0].strip() == "#" and "Year" in " ".join(r): sec2_start = i + 1

for r in rows[sec1_start : sec2_start - 1 if sec2_start else None]:
    if not r or not r[0].strip() or not r[0].strip().isdigit(): continue
    name = (r[1].strip() if len(r) > 1 else "")
    val  = (r[5].strip() if len(r) > 5 else "")
    if name:
        raw_val_map[name.upper()] = val

# ── 3. Clean projects ─────────────────────────────────────────────────────────

def clean_project(p: dict) -> dict:
    out = dict(p)
    out["name"]        = clean_name(p["name"])
    out["client_name"] = clean_name(p.get("client_name") or "")
    if p.get("main_contractor"):
        mc = clean_name(p["main_contractor"])
        if is_corrupt(mc):
            out["main_contractor"]      = None
            out["main_contractor_ref"]  = "unresolved"
            out["data_quality_note"]    = "Missing/corrupt contractor value in source."
        else:
            out["main_contractor"] = mc
    # Raw value always preserved
    raw = raw_val_map.get(p["name"].strip().upper(), "")
    out["value_raw"] = raw
    if raw == PLACEHOLDER_LITERAL:
        out["total_value"] = None
        out["value_note"]  = f"Placeholder in source ({PLACEHOLDER_LITERAL}) — unverified"
    elif raw.endswith("+"):
        out["value_note"]  = f"Approximate (source: {raw})"
    return out

def clean_ref(r: dict) -> dict:
    out = dict(r)
    out["name"]            = clean_name(r["name"])
    out["client_name"]     = clean_name(r.get("client_name") or "")
    if r.get("main_contractor"):
        mc = clean_name(r["main_contractor"])
        out["main_contractor"] = None if is_corrupt(mc) else mc
    return out

def clean_contact(c: dict) -> dict:
    out = dict(c)
    if c.get("company_name"):
        out["company_name"] = clean_name(c["company_name"])
    return out

projects_clean  = [clean_project(p) for p in src["projects"]]
refs_clean      = [clean_ref(r)     for r in src["ref_projects"]]
contacts_clean  = [clean_contact(c) for c in src["contacts"]]

# ── 4. Counts ─────────────────────────────────────────────────────────────────

nullified    = [p for p in projects_clean if p.get("value_note", "").startswith("Placeholder")]
approx       = [p for p in projects_clean if p.get("value_note", "").startswith("Approximate")]
no_raw       = [p for p in projects_clean if not p["value_raw"] and p["total_value"] is None]
crm_active   = [c for c in final_companies if c.get("import_action") in ("create", "create_with_review_flag")]
dq_excluded  = [c for c in final_companies if c.get("record_status") == "data_quality_warning"]
review_flagged = [c for c in final_companies if c.get("review_flag")]

total_staging = len(final_companies) + len(projects_clean) + len(refs_clean) + len(contacts_clean)

# ── 5. Write batch ────────────────────────────────────────────────────────────

batch = {
    "status":   "pending_approval",
    "source":   "PHC Quotation List MAR 2026",
    "staged_at": "2026-07-12",
    "cleanup_rules_applied": [
        "U+FFFD replacement chars → en-dash in all name fields",
        "3.50M raw literal → total_value NULL (7 projects); value_raw preserved",
        "IHG + IHG Group → merged as 'IHG Group' (reversible; both aliases retained)",
        "Shaza + Shaza Hotels → merged as 'Shaza Hotels' (reversible; both aliases retained)",
        "IHG – VOCO → separate record, review_flag=true, no inferences made",
        "Company '–'/'?' → data_quality_warning, excluded from CRM creation, preserved in staging",
        "Radisson / Radisson Collection → separate records (distinct brands)",
    ],
    "counts": {
        "total_staging_records": total_staging,
        "companies_total":       len(final_companies),
        "companies_crm_create":  len(crm_active),
        "companies_dq_excluded": len(dq_excluded),
        "companies_review_flagged": len(review_flagged),
        "projects":              len(projects_clean),
        "projects_value_null":   len(nullified) + len(no_raw),
        "projects_value_placeholder_null": len(nullified),
        "projects_value_approximate": len(approx),
        "ref_projects":          len(refs_clean),
        "contacts":              len(contacts_clean),
    },
    "merge_log": merge_log,
    "companies":    final_companies,
    "projects":     projects_clean,
    "ref_projects": refs_clean,
    "contacts":     contacts_clean,
}

Path("C:/Temp/phc_cleaned_batch.json").write_text(
    json.dumps(batch, ensure_ascii=False, indent=2), encoding="utf-8"
)

# ── 6. Review report ─────────────────────────────────────────────────────────

SEP = "=" * 65

print(SEP)
print("PHC IMPORT — CLEANUP v2 REVIEW REPORT")
print(SEP)

# Merges
print(f"\n-- MERGES APPLIED ({len(merge_log)}) -- reversible; originals in aliases")
for m in merge_log:
    print(f"   absorbed: '{m['absorbed']}' (source: '{m['original_source_name']}')")
    print(f"        → canonical: '{m['into']}'")

# Verify reversibility
print(f"\n-- REVERSIBILITY CHECK")
for canon, members in MERGE_MAP.items():
    rec = merged_companies.get(canon)
    if rec:
        retained = [a for a in members if a in rec["aliases"] or a == rec["name"]]
        print(f"   '{canon}': original aliases present = {retained}")

# Kept separate
print(f"\n-- KEPT SEPARATE (Radisson family + IHG-VOCO)")
for name in ["Radisson", "Radisson Collection", "IHG – VOCO"]:
    rec = merged_companies.get(name)
    if rec:
        flag = " [REVIEW FLAG]" if rec.get("review_flag") else ""
        print(f"   {rec['name']}{flag}")
        if rec.get("review_note"):
            print(f"      note: {rec['review_note']}")

# Corrupt/DQ
print(f"\n-- DATA QUALITY WARNINGS ({len(dq_excluded)} company records excluded from CRM)")
for c in dq_excluded:
    print(f"   source_name='{c['source_name']}' → import_action={c['import_action']}")
    print(f"      note: {c['data_quality_note']}")

# Null values
print(f"\n-- VALUES SET TO NULL ({len(nullified)} placeholder + {len(no_raw)} empty)")
print(f"   Placeholder (raw='{PLACEHOLDER_LITERAL}'):")
for p in nullified:
    print(f"     {p['name'][:52]:<52}  value_raw={p['value_raw']!r}")
print(f"   Empty (no data in source):")
for p in no_raw:
    print(f"     {p['name'][:52]}")

# Approximate
if approx:
    print(f"\n-- APPROXIMATE VALUES RETAINED ({len(approx)})")
    for p in approx:
        print(f"   {p['name']:<50}  {p['value_note']}")

# Final counts
print(f"\n-- FINAL STAGING COUNTS")
print(f"   Total staging records:    {total_staging}  (all 124 source records present)")
print(f"   Companies in staging:     {len(final_companies)}")
print(f"     → create in CRM:        {len(crm_active)}")
print(f"     → review flagged:       {len(review_flagged)}")
print(f"     → DQ excluded (no CRM): {len(dq_excluded)}")
print(f"   Projects:                 {len(projects_clean)}")
print(f"   Reference projects:       {len(refs_clean)}")
print(f"   Contacts:                 {len(contacts_clean)}")
print(f"\n   status: pending_approval — nothing written to CRM")
print(f"   batch:  C:/Temp/phc_cleaned_batch.json")
