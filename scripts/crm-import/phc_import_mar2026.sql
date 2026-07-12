-- PHC CRM IMPORT — generated from phc_cleaned_batch.json
-- Source: PHC Quotation List MAR 2026
-- Safeguard: single transaction; rollback on any error

BEGIN;

-- ============================================================
-- COMPANIES (48 rows: 47 create + 1 review_flagged)
-- Corrupt ?/– contractor is EXCLUDED (import_action=exclude_from_crm)
-- Skip-on-conflict: DO NOTHING if name already exists
-- ============================================================

INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'CENOMI', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'CENOMI');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'OSOOL', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'OSOOL');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Mawan Real Estate', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Mawan Real Estate');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'MAS ECC', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'MAS ECC');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'IHG Group', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"source_aliases": ["IHG"], "source_name": "IHG", "import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'IHG Group');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Al Basateen', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Al Basateen');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'NMDC', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'NMDC');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Saudi Icon', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Saudi Icon');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Saudi Binladin Group', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Saudi Binladin Group');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'SEVEN', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'SEVEN');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Shapoorji Pallonji', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Shapoorji Pallonji');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'MISK Foundation', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'MISK Foundation');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'SAUDICON', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'SAUDICON');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Samsung', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Samsung');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Laysen Valley', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Laysen Valley');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Al Saedan', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Al Saedan');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Radisson Collection', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Radisson Collection');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'HOLIDAY INN', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'HOLIDAY INN');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Dur Hospitality', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Dur Hospitality');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Al Saad Contracting Co.', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Al Saad Contracting Co.');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Shaza Hotels', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"source_aliases": ["Shaza"], "source_name": "Shaza", "import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Shaza Hotels');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Hesham Contracting', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Hesham Contracting');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Antara', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Antara');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'El Latifia Contracting', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'El Latifia Contracting');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'VOCO Hotel', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'VOCO Hotel');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Arabian Centres', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Arabian Centres');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Arabian National Bank', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Arabian National Bank');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Diplomatic Quarters', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Diplomatic Quarters');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Madinah Gate Development', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Madinah Gate Development');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'MRTC', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'MRTC');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'King Abdullah University of Science and Technology', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'King Abdullah University of Science and Technology');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'SAUDI BIGA', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'SAUDI BIGA');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Mansard Hotel', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Mansard Hotel');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'KSPF', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'KSPF');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Freyssinet', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Freyssinet');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Via Riyadh', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Via Riyadh');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Creative Art', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Creative Art');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Lina Snack Food Co.', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Lina Snack Food Co.');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Radisson', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Radisson');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Taibah Holiday Inn', 'main_contractor'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Taibah Holiday Inn');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Antara Real Estate', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Antara Real Estate');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'IHG – VOCO', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"source_aliases": ["IHG � VOCO"], "source_name": "IHG � VOCO", "import_source": "PHC Quotation List MAR 2026", "review_flag": true, "review_note": "Possible relationship with VOCO Hotel / IHG; requires manual entity resolution."}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'IHG – VOCO');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Unified Real Estate Dvt', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Unified Real Estate Dvt');
-- EXCLUDED (corrupt source): '�'

INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Damac Properties', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Damac Properties');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Al Rajhi Bank', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Al Rajhi Bank');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Al Waseel Hills Company', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Al Waseel Hills Company');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Various Clients', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Various Clients');
INSERT INTO companies (name, company_type, account_status, source, internal_notes)
  SELECT 'Marriott International', 'existing_client'::company_type, 'active'::account_status,
         'PHC Quotation List MAR 2026', '{"import_source": "PHC Quotation List MAR 2026"}'
  WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Marriott International');

-- ============================================================
-- PROJECTS (34 rows)
-- owner_company_id / main_contractor_id resolved by name lookup
-- 7 rows with 3.50M placeholder → total_value NULL
-- 3 SEVEN rows → total_value NULL (no source data)
-- All value_raw and audit data preserved in notes JSON
-- ============================================================

INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'SEVEN EXIT 15 AL NAHDA', 'Saudi Arabia', NULL, NULL, NULL,
    'unknown'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "", "scope": "Signage Fabrication & Installation"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'SEVEN EXIT 15 AL NAHDA');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'SEVEN MAKKAH ENTERTAINMENT COMPLEX', 'Saudi Arabia', NULL, NULL, NULL,
    'unknown'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "", "scope": "Signage Fabrication & Installation"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'SEVEN MAKKAH ENTERTAINMENT COMPLEX');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'SEVEN TAIF ENTERTAINMENT COMPLEX', 'Saudi Arabia', NULL, NULL, NULL,
    'unknown'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "", "scope": "Signage Fabrication & Installation"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'SEVEN TAIF ENTERTAINMENT COMPLEX');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'CENOMI - Westfield Jeddah', 'JEDDAH', (SELECT id FROM companies WHERE name = 'CENOMI' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 5100000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2026", "scope": "Signage Fabrication & Installation", "value_raw": "5.1 M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'CENOMI - Westfield Jeddah');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'GRANADA BUSINESS PARK', 'Riyadh', (SELECT id FROM companies WHERE name = 'OSOOL' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 500000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2026", "scope": "Signage Fabrication & Installation", "value_raw": "500K"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'GRANADA BUSINESS PARK');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Prime Business Park', 'Riyadh', (SELECT id FROM companies WHERE name = 'Mawan Real Estate' LIMIT 1), (SELECT id FROM companies WHERE name = 'MAS ECC' LIMIT 1), 2300000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2026", "scope": "Signage Fabrication & Installation", "value_raw": "2.30M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Prime Business Park');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'IHG Cabana Hotel', 'Riyadh', (SELECT id FROM companies WHERE name = 'IHG' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 500000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2025", "scope": "Signage Fabrication & Installation", "value_raw": "0.50M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'IHG Cabana Hotel');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Al Basateen Project', 'Riyadh', (SELECT id FROM companies WHERE name = 'Al Basateen' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 1300000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2025", "scope": "Signage Fabrication & Installation", "value_raw": "1.30M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Al Basateen Project');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'New Murabba Development', 'Riyadh', (SELECT id FROM companies WHERE name = 'NMDC' LIMIT 1), (SELECT id FROM companies WHERE name = 'Saudi Icon' LIMIT 1), 1450000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2025", "scope": "Signage Fabrication & Installation", "value_raw": "1.45M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'New Murabba Development');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Makkah Haram', 'Makkah', (SELECT id FROM companies WHERE name = 'Saudi Binladin Group' LIMIT 1), (SELECT id FROM companies WHERE name = 'Saudi Binladin Group' LIMIT 1), 1400000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2025", "scope": "Signage Fabrication & Installation", "value_raw": "1.40M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Makkah Haram');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'SEVEN Exit 10 Al Hamra', 'Riyadh', (SELECT id FROM companies WHERE name = 'SEVEN' LIMIT 1), (SELECT id FROM companies WHERE name = 'Shapoorji Pallonji' LIMIT 1), 3000000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2025", "scope": "Signage Fabrication & Installation", "value_raw": "3.00M+", "value_note": "Approximate (source: 3.00M+)"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'SEVEN Exit 10 Al Hamra');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Misk Art Institute', 'Riyadh', (SELECT id FROM companies WHERE name = 'MISK Foundation' LIMIT 1), (SELECT id FROM companies WHERE name = 'SAUDICON' LIMIT 1), 1000000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2025", "scope": "Signage Fabrication & Installation", "value_raw": "1.00M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Misk Art Institute');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'CENOMI – UWalk Jeddah', 'Jeddah', (SELECT id FROM companies WHERE name = 'CENOMI' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 1420000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2025", "scope": "Signage Fabrication & Installation", "value_raw": "1.42M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'CENOMI – UWalk Jeddah');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'CENOMI – Jeddah Park', 'Jeddah', (SELECT id FROM companies WHERE name = 'CENOMI' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 4410000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2025", "scope": "Signage Fabrication & Installation", "value_raw": "4.41M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'CENOMI – Jeddah Park');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Tadawul Samsung Tower', 'Riyadh', (SELECT id FROM companies WHERE name = 'Samsung' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 1450000,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2025", "scope": "Signage Fabrication & Installation", "value_raw": "1.45M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Tadawul Samsung Tower');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Laysen Valley', 'Riyadh', (SELECT id FROM companies WHERE name = 'Laysen Valley' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 1420000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2023", "scope": "Signage Fabrication & Installation", "value_raw": "1.42M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Laysen Valley');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Granada Mall', 'Riyadh', (SELECT id FROM companies WHERE name = 'OSOOL' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 3300000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2025", "scope": "Signage Fabrication & Installation", "value_raw": "3.30M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Granada Mall');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Courtyard by Marriott - Riyadh', 'Riyadh', (SELECT id FROM companies WHERE name = 'Al Saedan' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 1400000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2021", "scope": "Signage Fabrication & Installation", "value_raw": "1.40M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Courtyard by Marriott - Riyadh');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Mansard Riyadh', 'Riyadh', (SELECT id FROM companies WHERE name = 'Radisson Collection' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 1400000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2022", "scope": "Signage Fabrication & Installation", "value_raw": "1.40M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Mansard Riyadh');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Holiday Inn Al Jubail Taibah', 'Al Jubail', (SELECT id FROM companies WHERE name = 'HOLIDAY INN' LIMIT 1), (SELECT id FROM companies WHERE name = 'Dur Hospitality' LIMIT 1), 800000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2020", "scope": "Signage Fabrication & Installation", "value_raw": "0.80M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Holiday Inn Al Jubail Taibah');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Crowne Plaza Riyadh', 'Riyadh', (SELECT id FROM companies WHERE name = 'IHG' LIMIT 1), (SELECT id FROM companies WHERE name = 'Al Saad Contracting Co.' LIMIT 1), 1120000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2020", "scope": "Signage Fabrication & Installation", "value_raw": "1.12M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Crowne Plaza Riyadh');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Shaza Hotel', 'Madinah', (SELECT id FROM companies WHERE name = 'Shaza' LIMIT 1), (SELECT id FROM companies WHERE name = 'Hesham Contracting' LIMIT 1), 500000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2018", "scope": "Signage Fabrication & Installation", "value_raw": "0.50M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Shaza Hotel');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Antara Resort', 'Riyadh', (SELECT id FROM companies WHERE name = 'Antara' LIMIT 1), (SELECT id FROM companies WHERE name = 'El Latifia Contracting' LIMIT 1), 550000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2019", "scope": "Signage Fabrication & Installation", "value_raw": "0.55M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Antara Resort');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Voco Hotel', 'Riyadh', (SELECT id FROM companies WHERE name = 'VOCO Hotel' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 390000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2020", "scope": "Signage Fabrication & Installation", "value_raw": "0.39M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Voco Hotel');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Aloft Hotel', 'Riyadh', (SELECT id FROM companies WHERE name = 'Arabian Centres' LIMIT 1), (SELECT id FROM companies WHERE name = 'Arabian Centres' LIMIT 1), 250000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2017", "scope": "Signage Fabrication & Installation", "value_raw": "0.25M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Aloft Hotel');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Riyadh Gallery Mall', 'Riyadh', (SELECT id FROM companies WHERE name = 'Arabian National Bank' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 29000000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2021", "scope": "Signage Fabrication & Installation", "value_raw": "29.00M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Riyadh Gallery Mall');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Diplomatic Quarter', 'Riyadh', (SELECT id FROM companies WHERE name = 'Diplomatic Quarters' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), 200000,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2025", "scope": "Signage Fabrication & Installation", "value_raw": "0.20M"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Diplomatic Quarter');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Madinah Gate Development', 'Riyadh', (SELECT id FROM companies WHERE name = 'Madinah Gate Development' LIMIT 1), (SELECT id FROM companies WHERE name = 'MRTC' LIMIT 1), NULL,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2025", "scope": "Signage Fabrication & Installation", "value_raw": "3.50M", "value_note": "Placeholder in source (3.50M) — unverified"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Madinah Gate Development');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'SSOIEIKAUST - THUWAL', 'Riyadh', (SELECT id FROM companies WHERE name = 'King Abdullah University of Science and Technology' LIMIT 1), (SELECT id FROM companies WHERE name = 'SAUDI BIGA' LIMIT 1), NULL,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Ongoing 2025", "scope": "Signage Fabrication & Installation", "value_raw": "3.50M", "value_note": "Placeholder in source (3.50M) — unverified"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'SSOIEIKAUST - THUWAL');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Mansard Hotel', 'Riyadh', (SELECT id FROM companies WHERE name = 'Mansard Hotel' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), NULL,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2023", "scope": "Signage Fabrication & Installation", "value_raw": "3.50M", "value_note": "Placeholder in source (3.50M) — unverified"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Mansard Hotel');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'The View mall', 'Riyadh', (SELECT id FROM companies WHERE name = 'CENOMI' LIMIT 1), (SELECT id FROM companies WHERE name = 'Direct to Client' LIMIT 1), NULL,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2023", "scope": "Signage Fabrication & Installation", "value_raw": "3.50M", "value_note": "Placeholder in source (3.50M) — unverified"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'The View mall');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'King Salman Park (KSP)', 'Riyadh', (SELECT id FROM companies WHERE name = 'KSPF' LIMIT 1), (SELECT id FROM companies WHERE name = 'Freyssinet' LIMIT 1), NULL,
    'under_construction'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "On-going 2025", "scope": "Signage Fabrication & Installation", "value_raw": "3.50M", "value_note": "Placeholder in source (3.50M) — unverified"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'King Salman Park (KSP)');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Via Riyadh', 'Riyadh', (SELECT id FROM companies WHERE name = 'Via Riyadh' LIMIT 1), (SELECT id FROM companies WHERE name = 'Creative Art' LIMIT 1), NULL,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2022", "scope": "Signage Fabrication & Installation", "value_raw": "3.50M", "value_note": "Placeholder in source (3.50M) — unverified"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Via Riyadh');
INSERT INTO projects
  (name, location, owner_company_id, main_contractor_id, total_value,
   project_stage, source, source_confidence, signage_package_status,
   verification_status, notes)
  SELECT
    'Holiday Inn Airport', 'Riyadh', (SELECT id FROM companies WHERE name = 'Holiday Inn' LIMIT 1), (SELECT id FROM companies WHERE name = 'Lina Snack Food Co.' LIMIT 1), NULL,
    'completed'::project_stage, 'PHC Quotation List MAR 2026', 'medium'::confidence_level,
    'unknown'::signage_package_status, 'pending_verification'::verification_status,
    '{"source": "PHC Quotation List MAR 2026", "original_status": "Completed 2023", "scope": "Signage Fabrication & Installation", "value_raw": "3.50M", "value_note": "Placeholder in source (3.50M) — unverified"}'
  WHERE NOT EXISTS (SELECT 1 FROM projects WHERE name = 'Holiday Inn Airport');

-- ============================================================
-- REFERENCE PROJECTS (13 rows)
-- ============================================================

INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Courtyard by Marriott – Riyadh', 'Riyadh', 'Client: Al Saedan | MC: Direct to Client',
    2021, 'Hospitality Signage Package [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Courtyard by Marriott – Riyadh');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Mansard Riyadh – Radisson Collection', 'Riyadh', 'Client: Radisson | MC: Direct to Client',
    2022, 'Full Interior & Exterior Signage [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Mansard Riyadh – Radisson Collection');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Holiday Inn Al Jubail', 'Al Jubail', 'Client: Dur Hospitality | MC: Taibah Holiday Inn',
    2020, 'Hotel Signage [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Holiday Inn Al Jubail');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Diplomatic Quarter Development', 'Riyadh', 'Client: Unified Real Estate Dvt | MC: Direct to Client',
    2025, 'External Signage & Map Totems [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Diplomatic Quarter Development');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Mansard Hotel (Radisson Collection)', 'Riyadh', 'Client: Mansard Hotel | MC: Direct to Client',
    2023, 'Hospitality Signage & Digital Displays [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Mansard Hotel (Radisson Collection)');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Damac Tower / Showroom', 'Riyadh', 'Client: Damac Properties | MC: Direct to Client',
    2023, 'External Identification Signage [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Damac Tower / Showroom');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Information Center Building', 'Riyadh', 'Client: Private Client',
    2022, 'Internal Wayfinding Signage [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Information Center Building');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Al Rajhi Bank Headquarters', 'Riyadh', 'Client: Al Rajhi Bank',
    2023, 'Corporate Signage & Identification Systems [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Al Rajhi Bank Headquarters');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Al Waseel Hills Development', 'Riyadh', 'Client: Al Waseel Hills Company',
    2024, 'External Wayfinding Signage [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Al Waseel Hills Development');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Al Takasusi Business Center', 'Riyadh', 'Client: Private Client',
    2023, 'Internal Signage System [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Al Takasusi Business Center');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Car Park Facility', 'Riyadh', 'Client: Various Clients',
    2022, 'Parking Wayfinding System [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Car Park Facility');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Marriott Hotel', 'Riyadh', 'Client: Marriott International',
    2021, 'Hospitality Signage Package [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Marriott Hotel');
INSERT INTO reference_projects
  (name, city, client_or_contractor, year, phc_scope)
  SELECT
    'Holiday Inn (Various Branches)', 'Kingdom-wide', 'Client: IHG Group',
    2020, 'Multiple Hotel Signage Packages [src: PHC Quotation List MAR 2026]'
  WHERE NOT EXISTS (SELECT 1 FROM reference_projects WHERE name = 'Holiday Inn (Various Branches)');

-- ============================================================
-- CONTACTS (28 rows)
-- company_id resolved by company_name lookup
-- Defaults: authority=unknown_authority, location=unknown,
--           verification_status=pending_verification
-- ============================================================

INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Dowel Sanchez, Procurement CENOMI K.S.A. � +966 114350000.', NULL, '+966114350000',
    NULL, (SELECT id FROM companies WHERE name = 'CENOMI' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Dowel Sanchez, Procurement CENOMI K.S.A. � +966 114350000.'
    AND (company_id = (SELECT id FROM companies WHERE name = 'CENOMI' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Ahmad Ismail,Property�Management�DirectorMob +966 500778959', NULL, '+966500778959',
    NULL, (SELECT id FROM companies WHERE name = 'OSOOL' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Ahmad Ismail,Property�Management�DirectorMob +966 500778959'
    AND (company_id = (SELECT id FROM companies WHERE name = 'OSOOL' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'MAS ECC | Hesham Alihesham@masecc.comInfo@masecc.com', 'Alihesham@masecc.comInfo', NULL,
    NULL, (SELECT id FROM companies WHERE name = 'Mawan Real Estate' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'MAS ECC | Hesham Alihesham@masecc.comInfo@masecc.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Mawan Real Estate' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Nestor Mindoro| Material SecretaryIHG� InterContinental RiyadhNestor.Mindoro@ihg.com', 'RiyadhNestor.Mindoro@ihg.com', NULL,
    NULL, (SELECT id FROM companies WHERE name = 'IHG' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Nestor Mindoro| Material SecretaryIHG� InterContinental RiyadhNestor.Mindoro@ihg.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'IHG' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Rahamtallah OmerSenior Procurement EngineerPMP � � PMI-SP �� PMI-RMP �Toll Free: 92000 3749albasateen.sa', NULL, '920003749',
    NULL, (SELECT id FROM companies WHERE name = 'Al Basateen' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Rahamtallah OmerSenior Procurement EngineerPMP � � PMI-SP �� PMI-RMP �Toll Free: 92000 3749albasateen.sa'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Al Basateen' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Hussam AlbawabProcurement Engr., Saudi Iconh.albawab@saudi-icon.com', 'Iconh.albawab@saudi-icon.com', NULL,
    NULL, (SELECT id FROM companies WHERE name = 'NMDC' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Hussam AlbawabProcurement Engr., Saudi Iconh.albawab@saudi-icon.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'NMDC' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Adel Mahmoud AbdoSAUDI BINLADIN GROUP (ABCD)HARAM EXPANSION PROJECTProcurement and Bid SectionEmail : adel.abdo@sbg-mp.com', 'adel.abdo@sbg-mp.com', NULL,
    NULL, (SELECT id FROM companies WHERE name = 'Saudi Binladin Group' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Adel Mahmoud AbdoSAUDI BINLADIN GROUP (ABCD)HARAM EXPANSION PROJECTProcurement and Bid SectionEmail : adel.abdo@sbg-mp.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Saudi Binladin Group' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Satish KemkarDesign HeadShapoorji Pallonji Mideast L.L.CExit 10 project, Riyadh, K.S.Asatish.kemkar@shapoorji.com', 'K.S.Asatish.kemkar@shapoorji.com', NULL,
    NULL, (SELECT id FROM companies WHERE name = 'SEVEN' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Satish KemkarDesign HeadShapoorji Pallonji Mideast L.L.CExit 10 project, Riyadh, K.S.Asatish.kemkar@shapoorji.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'SEVEN' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Rafsan Hammie M. PalaoTendering Department SAUDICONT: +966 11 4765555 Ext. 183', NULL, '+966114765555',
    NULL, (SELECT id FROM companies WHERE name = 'MISK Foundation' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Rafsan Hammie M. PalaoTendering Department SAUDICONT: +966 11 4765555 Ext. 183'
    AND (company_id = (SELECT id FROM companies WHERE name = 'MISK Foundation' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Saudi Tadawul GroupCustomer Service Contact: (+966) 9200 13130 E-mail: info@tadawulgroup.', NULL, '920013130',
    NULL, (SELECT id FROM companies WHERE name = 'Samsung' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Saudi Tadawul GroupCustomer Service Contact: (+966) 9200 13130 E-mail: info@tadawulgroup.'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Samsung' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Laysen Valley | Purchasng Dept0505309999 � info@laysenvalley.sa', 'info@laysenvalley.sa', '0505309999',
    NULL, (SELECT id FROM companies WHERE name = 'Laysen Valley' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Laysen Valley | Purchasng Dept0505309999 � info@laysenvalley.sa'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Laysen Valley' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Eng. Alaa Altahir, CIPS L4Senior Procurement LeadTel: +966 112059922 Ext: 2218aaltahir@osoolre.com', '2218aaltahir@osoolre.com', '+966112059922',
    NULL, (SELECT id FROM companies WHERE name = 'OSOOL' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Eng. Alaa Altahir, CIPS L4Senior Procurement LeadTel: +966 112059922 Ext: 2218aaltahir@osoolre.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'OSOOL' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Al Saedan Real Estate CompanyProcurement and Purchasing9200 04365Info@alsaedan.com', '04365Info@alsaedan.com', '920004365',
    NULL, (SELECT id FROM companies WHERE name = 'Al Saedan' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Al Saedan Real Estate CompanyProcurement and Purchasing9200 04365Info@alsaedan.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Al Saedan' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Radisson Collection | Procurementinfo.mansard@radissoncollection.com.t +966 11 829 0900.', 'Procurementinfo.mansard@radissoncollection.com', '+966118290900',
    NULL, (SELECT id FROM companies WHERE name = 'Radisson Collection' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Radisson Collection | Procurementinfo.mansard@radissoncollection.com.t +966 11 829 0900.'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Radisson Collection' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Dur Hospitality | Procurement(+966) 11 481 6666 info@dur.sa.', 'info@dur.sa', '114816666',
    NULL, (SELECT id FROM companies WHERE name = 'HOLIDAY INN' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Dur Hospitality | Procurement(+966) 11 481 6666 info@dur.sa.'
    AND (company_id = (SELECT id FROM companies WHERE name = 'HOLIDAY INN' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'NEDAL ABDULRAHMAN ALIEstimation Unit HeadCivil EngineerE: nedal@alsaad.com.saT: +966 12 6830306', 'nedal@alsaad.com.saT', '+966126830306',
    NULL, (SELECT id FROM companies WHERE name = 'IHG' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'NEDAL ABDULRAHMAN ALIEstimation Unit HeadCivil EngineerE: nedal@alsaad.com.saT: +966 12 6830306'
    AND (company_id = (SELECT id FROM companies WHERE name = 'IHG' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Procurement Dept Contact: +966 53 634 8208.Email : info@hashem-sa.com', 'info@hashem-sa.com', '+966536348208',
    NULL, (SELECT id FROM companies WHERE name = 'Shaza' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Procurement Dept Contact: +966 53 634 8208.Email : info@hashem-sa.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Shaza' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Al Laatifia - Procurement Dept.+966 11 455 7417 (fax) or email latifia.build@latifia.com.', 'latifia.build@latifia.com', '+966114557417',
    NULL, (SELECT id FROM companies WHERE name = 'Antara' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Al Laatifia - Procurement Dept.+966 11 455 7417 (fax) or email latifia.build@latifia.com.'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Antara' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'AskProcurement@ ihg.com', NULL, NULL,
    NULL, (SELECT id FROM companies WHERE name = 'VOCO Hotel' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'AskProcurement@ ihg.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'VOCO Hotel' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Dowel Sanchez, Procurement CENOMI K.S.A. � +966 114350000.', NULL, '+966114350000',
    NULL, (SELECT id FROM companies WHERE name = 'Arabian Centres' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Dowel Sanchez, Procurement CENOMI K.S.A. � +966 114350000.'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Arabian Centres' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'ANB Procurement Office+966-11-4029000info@anb.com.sa.', 'Office+966-11-4029000info@anb.com.sa', '+966114029000',
    NULL, (SELECT id FROM companies WHERE name = 'Arabian National Bank' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'ANB Procurement Office+966-11-4029000info@anb.com.sa.'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Arabian National Bank' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Unified - Procurement Dept+966 11 207 5500.', NULL, '+966112075500',
    NULL, (SELECT id FROM companies WHERE name = 'Diplomatic Quarters' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Unified - Procurement Dept+966 11 207 5500.'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Diplomatic Quarters' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Jaseem PonnethTendering MRTCjaseem@mrtc.com.sa', 'MRTCjaseem@mrtc.com.sa', NULL,
    NULL, (SELECT id FROM companies WHERE name = 'Madinah Gate Development' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Jaseem PonnethTendering MRTCjaseem@mrtc.com.sa'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Madinah Gate Development' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Mutrik AlqataniSAUDI BIGA -  Civil Engrmutrik.alqahtani@saudibiga.com', 'Engrmutrik.alqahtani@saudibiga.com', NULL,
    NULL, (SELECT id FROM companies WHERE name = 'King Abdullah University of Science and Technology' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Mutrik AlqataniSAUDI BIGA -  Civil Engrmutrik.alqahtani@saudibiga.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'King Abdullah University of Science and Technology' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Radisson Collection | Procurementinfo.mansard@radissoncollection.com.t +966 11 829 0900.', 'Procurementinfo.mansard@radissoncollection.com', '+966118290900',
    NULL, (SELECT id FROM companies WHERE name = 'Mansard Hotel' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Radisson Collection | Procurementinfo.mansard@radissoncollection.com.t +966 11 829 0900.'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Mansard Hotel' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Mohammad Sulaiman	Material Manager	m 966-502186135	muhammad.sulaiman@fsa.com.sa>', 'muhammad.sulaiman@fsa.com.sa', '966502186135',
    NULL, (SELECT id FROM companies WHERE name = 'KSPF' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Mohammad Sulaiman	Material Manager	m 966-502186135	muhammad.sulaiman@fsa.com.sa>'
    AND (company_id = (SELECT id FROM companies WHERE name = 'KSPF' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Via Riyadh - Purchasing Deptcontact@viariyadh.com', 'Deptcontact@viariyadh.com', NULL,
    NULL, (SELECT id FROM companies WHERE name = 'Via Riyadh' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Via Riyadh - Purchasing Deptcontact@viariyadh.com'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Via Riyadh' LIMIT 1) OR company_id IS NULL)
  );
INSERT INTO contacts
  (name, email, phone, title, company_id, source,
   authority, location, verification_status)
  SELECT
    'Holiday Inn - Purchasing DeptCall +966-11-4612000', NULL, '+966114612000',
    NULL, (SELECT id FROM companies WHERE name = 'Holiday Inn' LIMIT 1), 'PHC Quotation List MAR 2026',
    'unknown_authority'::contact_authority, 'unknown'::contact_location,
    'pending_verification'::verification_status
  WHERE NOT EXISTS (
    SELECT 1 FROM contacts WHERE name = 'Holiday Inn - Purchasing DeptCall +966-11-4612000'
    AND (company_id = (SELECT id FROM companies WHERE name = 'Holiday Inn' LIMIT 1) OR company_id IS NULL)
  );

COMMIT;

-- SUMMARY
-- Companies to INSERT:      48  (47 normal + 1 review-flagged)
-- Companies excluded:       1  (DQ warning, staging-only)
-- Projects to INSERT:       34
-- Projects value=NULL:      10  (7 placeholder + 3 no data)
-- Reference projects:       13
-- Contacts to INSERT:       28