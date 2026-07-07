-- =========================================================
-- OPTIONAL demo seed — realistic PHC-style pipeline data.
-- Run manually (SQL editor / `supabase db execute`) on a dev or
-- pilot environment only. NOT a migration; never run on live data.
-- Project names mirror PHC's real reference sectors but all
-- values, contacts and statuses here are fictional placeholders.
-- =========================================================

WITH new_opps AS (
  INSERT INTO public.opportunities
    (project_name, client, main_contractor, location, sector, tier, stage, project_stage,
     signage_package_status, signage_package_confidence, estimated_value_min, estimated_value_max,
     next_action, next_action_due, agent_recommendation, agent_reasoning, source_confidence, last_activity_at)
  VALUES
    ('King Salman Park — Visitor Hub', 'King Salman Park Foundation', 'ALEC Saudi', 'Riyadh', 'Giga Project',
     'A', 'follow_up', 'under_construction', 'confirmed', 'high', 1800000, 2400000,
     'Follow up on submitted quotation', CURRENT_DATE + 2, 'proceed',
     'Signage package confirmed in tender documents; PHC prequalified with main contractor.', 'high', now() - interval '1 day'),
    ('Diriyah Gate — Phase 2 Retail', 'Diriyah Company', 'Salini / El Seif JV', 'Riyadh', 'Mixed-Use',
     'A', 'quotation', 'under_construction', 'likely', 'medium', 900000, 1400000,
     'Prepare BOQ-based quotation draft', CURRENT_DATE + 4, 'proceed',
     'Similar package delivered in Phase 1; contractor relationship active.', 'high', now() - interval '2 days'),
    ('SEVEN Entertainment — Abha', 'SEVEN', 'Almabani', 'Abha', 'Entertainment',
     'B', 'qualification', 'awarded', 'unknown', 'low', 400000, 700000,
     'Verify signage scope with project team', CURRENT_DATE + 7, 'management_review',
     'Project awarded recently; signage package not yet visible in public sources.', 'medium', now() - interval '3 days'),
    ('New Murabba — Gateway District', 'New Murabba Development Co', 'China State Construction', 'Riyadh', 'Giga Project',
     'A', 'discovery', 'early_planning', 'unknown', 'low', 2000000, 3500000,
     'Monitor design development milestones', CURRENT_DATE + 30, NULL,
     NULL, 'low', now() - interval '5 days'),
    ('CENOMI — Jawharat Jeddah Mall', 'CENOMI Centers', 'Nesma & Partners', 'Jeddah', 'Retail',
     'B', 'preparation', 'near_handover', 'confirmed', 'high', 600000, 850000,
     'Site validation visit before quoting', CURRENT_DATE + 1, 'proceed',
     'Handover approaching — highest urgency window per project-stage policy.', 'high', now()),
    ('Red Sea — Coastal Resort Cluster', 'Red Sea Global', 'Unknown', 'Umluj', 'Hospitality',
     'C', 'qualification', 'design_development', 'likely', 'low', 250000, 450000,
     'Identify main contractor before proceeding', CURRENT_DATE + 14, 'management_review',
     'Below 300K floor at minimum estimate — needs strategic-exception review.', 'low', now() - interval '8 days')
  RETURNING id, project_name
)
, s AS (
  INSERT INTO public.stakeholders (opportunity_id, name, role, organization, contact_confidence)
  SELECT id, x.name, x.role, x.org, x.conf::public.confidence_level
  FROM new_opps
  JOIN LATERAL (
    VALUES
      ('Eng. Khalid Al-Harbi', 'Procurement Manager', 'Main Contractor', 'medium'),
      ('Sarah Mitchell', 'Commercial Manager', 'Main Contractor', 'low')
  ) AS x(name, role, org, conf) ON true
  WHERE project_name IN ('King Salman Park — Visitor Hub', 'Diriyah Gate — Phase 2 Retail')
  RETURNING id
)
, f AS (
  INSERT INTO public.follow_ups (opportunity_id, due_date, cadence_tier, channel, status, notes)
  SELECT id, CURRENT_DATE + 2, 'A', 'call', 'scheduled', 'Check quotation review status with procurement.'
  FROM new_opps WHERE project_name = 'King Salman Park — Visitor Hub'
  RETURNING id
)
, b AS (
  INSERT INTO public.boqs (related_opportunity_id, title, status, source, source_confidence, assumptions, estimated_value)
  SELECT id,
         'Wayfinding Package — ' || project_name,
         CASE WHEN project_name LIKE 'King Salman%' THEN 'verified'::public.boq_status
              ELSE 'estimated_scope'::public.boq_status END,
         CASE WHEN project_name LIKE 'King Salman%' THEN 'Client tender BOQ (official)' ELSE 'Benchmarked from similar PHC project' END,
         CASE WHEN project_name LIKE 'King Salman%' THEN 'high'::public.confidence_level ELSE 'medium'::public.confidence_level END,
         CASE WHEN project_name LIKE 'King Salman%' THEN NULL ELSE 'Scope estimated from Phase 1 quantities; site survey pending.' END,
         CASE WHEN project_name LIKE 'King Salman%' THEN 2100000 ELSE 1100000 END
  FROM new_opps
  WHERE project_name IN ('King Salman Park — Visitor Hub', 'Diriyah Gate — Phase 2 Retail')
  RETURNING id, related_opportunity_id, title
)
INSERT INTO public.quotations (related_opportunity_id, boq_id, quote_number, value, status, issued_date, valid_until)
SELECT b.related_opportunity_id, b.id,
       CASE WHEN b.title LIKE '%King Salman%' THEN 'PHC-Q-2026-041' ELSE 'PHC-Q-2026-047' END,
       CASE WHEN b.title LIKE '%King Salman%' THEN 2150000 ELSE 1180000 END,
       CASE WHEN b.title LIKE '%King Salman%' THEN 'submitted'::public.quotation_status ELSE 'draft'::public.quotation_status END,
       CURRENT_DATE - 10,
       CURRENT_DATE + 20
FROM b;

-- BOQ items for the verified BOQ
INSERT INTO public.boq_items (boq_id, sign_type, size, material, quantity, location, unit_rate, confidence, sort_order)
SELECT id, x.sign_type, x.size, x.material, x.qty, x.loc, x.rate, 'high'::public.confidence_level, x.ord
FROM public.boqs
JOIN LATERAL (
  VALUES
    ('Monolith Directory (External)', '2400x800mm', 'Aluminium + LED', 12, 'Entry plazas', 28500, 1),
    ('Directional Blade Sign', '1200x300mm', 'Aluminium', 86, 'Pedestrian routes', 3400, 2),
    ('Parking Level ID', '600x600mm', 'ACP + Vinyl', 140, 'Parking levels', 950, 3),
    ('Safety & Regulatory Set', 'Mixed', 'ACP', 220, 'Back of house', 420, 4)
) AS x(sign_type, size, material, qty, loc, rate, ord) ON true
WHERE title LIKE '%King Salman%'
  AND NOT EXISTS (SELECT 1 FROM public.boq_items bi WHERE bi.boq_id = public.boqs.id);
