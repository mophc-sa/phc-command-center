"""
PHC CRM Import — atomic SQL transaction generator + executor.

Reads:  C:/Temp/phc_cleaned_batch.json  (status: pending_approval)
Output: C:/Temp/phc_import.sql   (transaction; NOT auto-executed)
        C:/Temp/phc_import_result.json

Safeguards:
  - Only writes to lrfdtoexyeghrzynapyn (PHC AGENT).
  - Wrapped in BEGIN / COMMIT — any row error triggers full rollback.
  - No update/overwrite of existing CRM records — skip on name conflict.
  - Corrupt company (exclude_from_crm) → NOT inserted in companies table.
  - review_flag companies → inserted, with flag stored in internal_notes.
  - All 7 raw "3.50M" strings preserved in projects.notes audit block.
  - Aliases stored in companies.internal_notes as JSON audit block.
  - project_stage mapping:
      "Ongoing"   → under_construction
      "Completed" → completed
      (blank)     → unknown
  - company_type mapping:
      "client"           → existing_client
      "main_contractor"  → main_contractor
"""
import sys; sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import json, re, subprocess, uuid, textwrap
from pathlib import Path

BATCH_FILE  = "C:/Temp/phc_cleaned_batch.json"
SQL_OUT     = "C:/Temp/phc_import.sql"
RESULT_FILE = "C:/Temp/phc_import_result.json"
SOURCE_TAG  = "PHC Quotation List MAR 2026"

batch = json.loads(Path(BATCH_FILE).read_text(encoding="utf-8"))
assert batch["status"] == "pending_approval", "Batch not in pending_approval state"

# ── helpers ───────────────────────────────────────────────────────────────────

def esc(s):
    """Escape a string for SQL single-quote literal."""
    if s is None: return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def nullable(v):
    if v is None: return "NULL"
    if isinstance(v, bool): return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)): return str(v)
    return esc(v)

def company_type_map(t: str) -> str:
    return {
        "client": "existing_client",
        "main_contractor": "main_contractor",
    }.get(t, "existing_client")

def project_stage_map(status: str) -> str:
    s = (status or "").lower()
    if "ongoing" in s or "on-going" in s: return "under_construction"
    if "complet" in s: return "completed"
    return "unknown"

# ── build SQL ─────────────────────────────────────────────────────────────────

lines = []
lines.append("-- PHC CRM IMPORT — generated from phc_cleaned_batch.json")
lines.append(f"-- Source: {SOURCE_TAG}")
lines.append("-- Safeguard: single transaction; rollback on any error")
lines.append("")
lines.append("BEGIN;")
lines.append("")

# ── SECTION 1: Companies ──────────────────────────────────────────────────────
lines.append("-- ============================================================")
lines.append("-- COMPANIES (48 rows: 47 create + 1 review_flagged)")
lines.append("-- Corrupt ?/– contractor is EXCLUDED (import_action=exclude_from_crm)")
lines.append("-- Skip-on-conflict: DO NOTHING if name already exists")
lines.append("-- ============================================================")
lines.append("")

company_insert_count = 0
for c in batch["companies"]:
    if c.get("import_action") == "exclude_from_crm":
        lines.append(f"-- EXCLUDED (corrupt source): {esc(c['source_name'])}")
        lines.append("")
        continue

    ctype = company_type_map(c.get("company_type", "client"))

    # Build internal_notes audit block
    audit = {}
    if c.get("aliases"):
        audit["source_aliases"] = c["aliases"]
    if c.get("source_name") and c["source_name"] != c["name"]:
        audit["source_name"] = c["source_name"]
    audit["import_source"] = SOURCE_TAG
    if c.get("review_flag"):
        audit["review_flag"] = True
        audit["review_note"] = c.get("review_note", "")

    notes_json = json.dumps(audit, ensure_ascii=False)

    lines.append(
        f"INSERT INTO companies (name, company_type, account_status, source, internal_notes)"
        f"\n  SELECT {esc(c['name'])}, {esc(ctype)}::company_type, 'active'::account_status,"
        f"\n         {esc(SOURCE_TAG)}, {esc(notes_json)}"
        f"\n  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = {esc(c['name'])});"
    )
    company_insert_count += 1

lines.append("")
lines.append("-- ============================================================")
lines.append("-- PROJECTS (34 rows)")
lines.append("-- owner_company_id / main_contractor_id resolved by name lookup")
lines.append("-- 7 rows with 3.50M placeholder → total_value NULL")
lines.append("-- 3 SEVEN rows → total_value NULL (no source data)")
lines.append("-- All value_raw and audit data preserved in notes JSON")
lines.append("-- ============================================================")
lines.append("")

for p in batch["projects"]:
    stage   = project_stage_map(p.get("status", ""))
    client  = p.get("client_name") or ""
    mc      = p.get("main_contractor") or ""
    val     = nullable(p.get("total_value"))

    # Audit block in notes
    audit = {
        "source": SOURCE_TAG,
        "original_status": p.get("status", ""),
        "scope": p.get("scope", ""),
    }
    if p.get("value_raw"):
        audit["value_raw"] = p["value_raw"]
    if p.get("value_note"):
        audit["value_note"] = p["value_note"]
    if p.get("data_quality_note"):
        audit["contractor_dq"] = p["data_quality_note"]

    notes_json = json.dumps(audit, ensure_ascii=False)

    # owner_company_id subquery
    if client:
        owner_sub = f"(SELECT id FROM companies WHERE name = {esc(client)} LIMIT 1)"
    else:
        owner_sub = "NULL"

    # main_contractor_id subquery — skip if flagged as unresolved
    if mc and p.get("main_contractor_ref") != "unresolved":
        mc_sub = f"(SELECT id FROM companies WHERE name = {esc(mc)} LIMIT 1)"
    else:
        mc_sub = "NULL"

    lines.append(
        f"INSERT INTO projects"
        f"\n  (name, location, owner_company_id, main_contractor_id, total_value,"
        f"\n   project_stage, source, source_confidence, signage_package_status,"
        f"\n   verification_status, notes)"
        f"\n  SELECT"
        f"\n    {esc(p['name'])}, {nullable(p.get('location'))}, {owner_sub}, {mc_sub}, {val},"
        f"\n    {esc(stage)}::project_stage, {esc(SOURCE_TAG)}, 'medium'::confidence_level,"
        f"\n    'unknown'::signage_package_status, 'pending_verification'::verification_status,"
        f"\n    {esc(notes_json)}"
        f"\n  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = {esc(p['name'])});"
    )

lines.append("")
lines.append("-- ============================================================")
lines.append("-- REFERENCE PROJECTS (13 rows)")
lines.append("-- ============================================================")
lines.append("")

for r in batch["ref_projects"]:
    # client_or_contractor: combine client + contractor info
    parts = []
    if r.get("client_name"): parts.append(f"Client: {r['client_name']}")
    if r.get("main_contractor"): parts.append(f"MC: {r['main_contractor']}")
    client_mc_str = " | ".join(parts) if parts else None

    # reference_projects has no 'source' column; embed source tag in phc_scope
    scope_with_src = r.get("scope") or ""
    if scope_with_src:
        scope_with_src = f"{scope_with_src} [src: {SOURCE_TAG}]"
    else:
        scope_with_src = f"[src: {SOURCE_TAG}]"

    lines.append(
        f"INSERT INTO reference_projects"
        f"\n  (name, city, client_or_contractor, year, phc_scope)"
        f"\n  SELECT"
        f"\n    {esc(r['name'])}, {nullable(r.get('location'))}, {nullable(client_mc_str)},"
        f"\n    {nullable(r.get('year_completed'))}, {esc(scope_with_src)}"
        f"\n  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = {esc(r['name'])});"
    )

lines.append("")
lines.append("-- ============================================================")
lines.append("-- CONTACTS (28 rows)")
lines.append("-- company_id resolved by company_name lookup")
lines.append("-- Defaults: authority=unknown_authority, location=unknown,")
lines.append("--           verification_status=pending_verification")
lines.append("-- ============================================================")
lines.append("")

for c in batch["contacts"]:
    comp = c.get("company_name") or ""
    if comp:
        comp_sub = f"(SELECT id FROM companies WHERE name = {esc(comp)} LIMIT 1)"
    else:
        comp_sub = "NULL"

    # Skip contacts with no name
    if not (c.get("name") or "").strip():
        lines.append(f"-- SKIPPED contact: no name (company={comp!r})")
        continue

    lines.append(
        f"INSERT INTO contacts"
        f"\n  (name, email, phone, title, company_id, source,"
        f"\n   authority, location, verification_status)"
        f"\n  SELECT"
        f"\n    {esc(c['name'])}, {nullable(c.get('email'))}, {nullable(c.get('phone'))},"
        f"\n    {nullable(c.get('title'))}, {comp_sub}, {esc(SOURCE_TAG)},"
        f"\n    'unknown_authority'::contact_authority, 'unknown'::contact_location,"
        f"\n    'pending_verification'::verification_status"
        f"\n  WHERE NOT EXISTS ("
        f"\n    SELECT 1 FROM contacts WHERE name = {esc(c['name'])}"
        f"\n    AND (company_id = {comp_sub} OR company_id IS NULL)"
        f"\n  );"
    )

lines.append("")
lines.append("COMMIT;")
lines.append("")

# ── count summary appended as SQL comments ─────────────────────────────────────
companies_to_insert  = sum(1 for c in batch["companies"] if c.get("import_action") != "exclude_from_crm")
companies_review     = sum(1 for c in batch["companies"] if c.get("import_action") == "create_with_review_flag")
companies_excluded   = sum(1 for c in batch["companies"] if c.get("import_action") == "exclude_from_crm")
proj_null_val        = sum(1 for p in batch["projects"]  if p.get("total_value") is None)

lines.append(f"-- SUMMARY")
lines.append(f"-- Companies to INSERT:      {companies_to_insert}  (47 normal + {companies_review} review-flagged)")
lines.append(f"-- Companies excluded:       {companies_excluded}  (DQ warning, staging-only)")
lines.append(f"-- Projects to INSERT:       {len(batch['projects'])}")
lines.append(f"-- Projects value=NULL:      {proj_null_val}  (7 placeholder + 3 no data)")
lines.append(f"-- Reference projects:       {len(batch['ref_projects'])}")
lines.append(f"-- Contacts to INSERT:       {len(batch['contacts'])}")

sql_text = "\n".join(lines)
Path(SQL_OUT).write_text(sql_text, encoding="utf-8")
print(f"SQL written → {SQL_OUT}")
print(f"Lines: {len(lines)}")
print(f"\nCompanies INSERT: {companies_to_insert} ({companies_review} with review_flag), excluded: {companies_excluded}")
print(f"Projects INSERT:  {len(batch['projects'])}  (value=NULL: {proj_null_val})")
print(f"Ref projects:     {len(batch['ref_projects'])}")
print(f"Contacts:         {len(batch['contacts'])}")
print(f"\nReady to execute: supabase db query --file C:/Temp/phc_import.sql")
