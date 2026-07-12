"""
Parse PHC Quotation List CSV and extract normalized CRM records.
Outputs: companies, contacts, projects, reference_projects as SQL preview.
"""
import csv, re, json, sys
from pathlib import Path

CSV_PATH = r"E:\Downloads\PHC Quotation List - MAR 2026(PHC PROJECT REFERENCE).csv"

# ── helpers ────────────────────────────────────────────────────────────────────
def clean(v): return (v or "").strip().strip("?").strip()
def money(v):
    """'5.1 M' → 5100000, '500K' → 500000, '29.00M' → 29000000"""
    v = clean(v).replace(" ", "").replace(",", "")
    if not v: return None
    try:
        m = re.match(r"([\d.]+)(M|K)?", v, re.I)
        if not m: return None
        n = float(m.group(1))
        if m.group(2) and m.group(2).upper() == "M": n *= 1_000_000
        elif m.group(2) and m.group(2).upper() == "K": n *= 1_000
        return int(n)
    except: return None

def status_to_stage(s):
    s = clean(s).lower()
    if "ongoing" in s or "on-going" in s: return "rfq_received"
    if "complet" in s: return "won"
    return "rfq_received"

def parse_contact_block(text):
    """Extract name, email, phone from freeform contact cell."""
    if not text: return None
    lines = [l.strip() for l in re.split(r'[\r\n]+', text) if l.strip()]
    name = lines[0] if lines else None
    email = None; phone = None
    for l in lines:
        e = re.search(r'[\w.+-]+@[\w.-]+\.[a-z]{2,}', l, re.I)
        if e: email = e.group(0)
        p = re.search(r'\+?[\d\s-]{9,}', l)
        if p:
            candidate = re.sub(r'[^\d+]', '', p.group(0))
            if len(candidate) >= 9: phone = candidate
    # clean name — remove role keywords at start if they creep in
    return {"name": name, "email": email, "phone": phone}

# ── read raw CSV ───────────────────────────────────────────────────────────────
raw = Path(CSV_PATH).read_text(encoding="utf-8-sig", errors="replace")
lines = raw.splitlines()

companies: dict[str, dict] = {}   # name → record
contacts:  list[dict] = []
projects:  list[dict] = []
ref_projects: list[dict] = []

def add_company(name, ctype="client"):
    key = re.sub(r'\s+', ' ', clean(name)).upper()
    if not key or key in ("-", "?", "DIRECT TO CLIENT", "PRIVATE CLIENT"): return None
    if key not in companies:
        companies[key] = {"name": clean(name), "company_type": ctype, "account_status": "active"}
    return key

# ── Section 1: Sr.# header at row 2 (index 1) ────────────────────────────────
reader = csv.reader(lines)
rows = list(reader)

sec1_start = None; sec2_start = None
for i, r in enumerate(rows):
    if r and "Sr. #" in r[0]: sec1_start = i + 1
    if r and r[0].strip() == "#" and "Year" in " ".join(r): sec2_start = i + 1

# Section 1 rows
for r in rows[sec1_start:sec2_start-1 if sec2_start else None]:
    if not r or not r[0].strip() or not r[0].strip().isdigit(): continue
    sr, proj_name, client, contractor, scope, value_raw, location, status, *contact_parts = r + [""] * 9
    proj_name = clean(proj_name); client = clean(client); contractor = clean(contractor)
    if not proj_name: continue

    client_key = add_company(client, "client")
    contractor_key = add_company(contractor, "main_contractor")

    value = money(value_raw)
    # skip obvious placeholder "3.50M" rows that appear at end of section
    contact_text = " ".join(contact_parts).strip()

    projects.append({
        "name": proj_name,
        "location": clean(location) or "Saudi Arabia",
        "client_name": clean(client),
        "main_contractor": clean(contractor) if contractor else None,
        "scope": clean(scope) or "Signage Fabrication & Installation",
        "total_value": value,
        "status": clean(status),
        "stage": status_to_stage(status),
        "source": "PHC Quotation List MAR 2026",
    })

    if contact_text:
        parsed = parse_contact_block(contact_text)
        if parsed and parsed["name"]:
            contacts.append({
                **parsed,
                "company_name": clean(client) or clean(contractor),
                "title": None,
            })

# Section 2 rows (reference projects)
if sec2_start:
    for r in rows[sec2_start:]:
        if not r or not r[0].strip() or not r[0].strip().isdigit(): continue
        nr, proj_name, client, contractor, scope, location, year = (r + [""] * 7)[:7]
        proj_name = clean(proj_name); client = clean(client); contractor = clean(contractor)
        if not proj_name: continue
        add_company(client, "client")
        add_company(contractor, "main_contractor")
        year_clean = re.search(r'\d{4}', clean(year))
        ref_projects.append({
            "name": proj_name,
            "location": clean(location) or "Saudi Arabia",
            "client_name": clean(client),
            "main_contractor": clean(contractor) if contractor else None,
            "scope": clean(scope) or "Signage Fabrication & Installation",
            "year_completed": int(year_clean.group(0)) if year_clean else None,
            "source": "PHC Quotation List MAR 2026",
        })

# ── de-duplicate contacts by name+company ─────────────────────────────────────
seen_contacts = set()
unique_contacts = []
for c in contacts:
    key = (c["name"].upper().strip(), c["company_name"].upper().strip())
    if key not in seen_contacts:
        seen_contacts.add(key)
        unique_contacts.append(c)

# ── de-duplicate ref_projects by name ─────────────────────────────────────────
proj_names = {p["name"].upper() for p in projects}
unique_ref = [r for r in ref_projects if r["name"].upper() not in proj_names]

import sys; sys.stdout.reconfigure(encoding='utf-8', errors='replace')
# -- summary -------------------------------------------------------------------
print("=" * 60)
print("PHC IMPORT PREVIEW")
print("=" * 60)
print(f"\nCompanies to create:         {len(companies)}")
print(f"Projects (active/ongoing):   {len(projects)}")
print(f"Reference projects (new):    {len(unique_ref)}")
print(f"Contacts:                    {len(unique_contacts)}")

print("\n-- COMPANIES " + "-"*47)
for k, c in sorted(companies.items()):
    print(f"  [{c['company_type'][:5]}] {c['name']}")

print("\n-- PROJECTS (Section 1) " + "-"*36)
for p in projects:
    val = f"{p['total_value']:,}" if p['total_value'] else "?"
    print(f"  {p['name'][:45]:<45} | {p['status'][:20]:<20} | {val} SAR")

print("\n-- REFERENCE PROJECTS (Section 2, new only) " + "-"*16)
for r in unique_ref:
    print(f"  {r['name'][:45]:<45} | {r['year_completed']}")

print("\n-- CONTACTS " + "-"*48)
for c in unique_contacts:
    print(f"  {c['name'][:30]:<30} | {c['company_name'][:25]:<25} | {c['email'] or ''}")

# Write JSON for next step
out = {
    "companies": list(companies.values()),
    "projects": projects,
    "ref_projects": unique_ref,
    "contacts": unique_contacts,
}
Path("C:/Temp/phc_import_data.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n✓ Data written to C:/Temp/phc_import_data.json")
print(f"\nTotal records to insert: {len(companies)+len(projects)+len(unique_ref)+len(unique_contacts)}")
