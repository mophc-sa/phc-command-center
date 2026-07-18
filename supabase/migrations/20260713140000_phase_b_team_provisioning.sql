-- =========================================================
-- Phase B: Team provisioning + Mohammed legacy role cleanup
--
-- PRE-CONDITION (human step — cannot be automated):
--   The following 6 users must have accepted their Supabase invitation
--   and completed sign-up BEFORE this migration is applied.
--   Invite via: Supabase Dashboard → Authentication → Users → Invite user
--
--     mbassem@phc-sa.com   — Bassem Kallas        (Managing Director)
--     ahmad@phc-sa.com     — Ahmad Kallas          (General Manager)
--     omar@phc-sa.com      — Omar Kallas           (Sales Manager)
--     marie@phc-sa.com     — Marie Falome          (Business Development Manager)
--     a.jarrah@phc-sa.com  — Abdelrahman Jarrah    (Salesperson)
--     fisal@phc-sa.com     — Faisal Abdulkadhar    (Salesperson)
--
-- If any user has not accepted yet this migration is SAFE TO RE-RUN —
-- it skips that user with a NOTICE and continues.  Idempotent throughout.
--
-- What this migration does (ordered to satisfy protect_last_manager):
--   1. Activate + role-assign the 6 new team members.
--   2. Ensure moalagab@phc-sa.com holds system_admin.
--   3. Remove Mohammed's remaining legacy commercial roles
--      (ceo, bd_manager, viewer) — sales_manager was removed in Sprint 1E.
--      This step runs AFTER step 1 so the last-manager guard can never fire.
-- =========================================================

DO $$
DECLARE
  -- New team members
  _bassem_id    uuid;
  _ahmad_id     uuid;
  _omar_id      uuid;
  _marie_id     uuid;
  _jarrah_id    uuid;
  _fisal_id     uuid;

  -- Mohammed (system admin)
  _mo_id        uuid;

  _any_missing  boolean := false;
BEGIN

  -- ── Resolve all 6 new users by email ──────────────────────────────────────

  SELECT id INTO _bassem_id  FROM public.profiles WHERE email = 'mbassem@phc-sa.com'  LIMIT 1;
  SELECT id INTO _ahmad_id   FROM public.profiles WHERE email = 'ahmad@phc-sa.com'    LIMIT 1;
  SELECT id INTO _omar_id    FROM public.profiles WHERE email = 'omar@phc-sa.com'     LIMIT 1;
  SELECT id INTO _marie_id   FROM public.profiles WHERE email = 'marie@phc-sa.com'    LIMIT 1;
  SELECT id INTO _jarrah_id  FROM public.profiles WHERE email = 'a.jarrah@phc-sa.com' LIMIT 1;
  SELECT id INTO _fisal_id   FROM public.profiles WHERE email = 'fisal@phc-sa.com'    LIMIT 1;

  IF _bassem_id  IS NULL THEN RAISE NOTICE 'Phase B: mbassem@phc-sa.com not found — invite pending.';  _any_missing := true; END IF;
  IF _ahmad_id   IS NULL THEN RAISE NOTICE 'Phase B: ahmad@phc-sa.com not found — invite pending.';    _any_missing := true; END IF;
  IF _omar_id    IS NULL THEN RAISE NOTICE 'Phase B: omar@phc-sa.com not found — invite pending.';     _any_missing := true; END IF;
  IF _marie_id   IS NULL THEN RAISE NOTICE 'Phase B: marie@phc-sa.com not found — invite pending.';    _any_missing := true; END IF;
  IF _jarrah_id  IS NULL THEN RAISE NOTICE 'Phase B: a.jarrah@phc-sa.com not found — invite pending.'; _any_missing := true; END IF;
  IF _fisal_id   IS NULL THEN RAISE NOTICE 'Phase B: fisal@phc-sa.com not found — invite pending.';    _any_missing := true; END IF;

  -- ── Step 1: Activate + grant roles for each user found ────────────────────
  --
  -- Order matters: managing_director (Bassem) and sales_manager (Omar) MUST
  -- be inserted BEFORE Mohammed's commercial roles are removed in step 3.
  -- protect_last_manager counts remaining holders; having ≥1 new holder
  -- already inserted means the delete can never be "last manager".

  -- Bassem Kallas — Managing Director
  IF _bassem_id IS NOT NULL THEN
    UPDATE public.profiles
      SET status = 'active', full_name = 'Bassem Kallas'
      WHERE id = _bassem_id AND (status <> 'active' OR full_name IS DISTINCT FROM 'Bassem Kallas');

    INSERT INTO public.user_roles (user_id, role)
      VALUES (_bassem_id, 'managing_director')
      ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (NULL, 'system', 'user.approved', 'user_role', _bassem_id::text,
              jsonb_build_object('role','managing_director','reason','Phase B provisioning'));

    RAISE NOTICE 'Phase B: Bassem Kallas (mbassem) → managing_director, status=active.';
  END IF;

  -- Ahmad Kallas — General Manager
  IF _ahmad_id IS NOT NULL THEN
    UPDATE public.profiles
      SET status = 'active', full_name = 'Ahmad Kallas'
      WHERE id = _ahmad_id AND (status <> 'active' OR full_name IS DISTINCT FROM 'Ahmad Kallas');

    INSERT INTO public.user_roles (user_id, role)
      VALUES (_ahmad_id, 'general_manager')
      ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (NULL, 'system', 'user.approved', 'user_role', _ahmad_id::text,
              jsonb_build_object('role','general_manager','reason','Phase B provisioning'));

    RAISE NOTICE 'Phase B: Ahmad Kallas (ahmad) → general_manager, status=active.';
  END IF;

  -- Omar Kallas — Sales Manager
  IF _omar_id IS NOT NULL THEN
    UPDATE public.profiles
      SET status = 'active', full_name = 'Omar Kallas'
      WHERE id = _omar_id AND (status <> 'active' OR full_name IS DISTINCT FROM 'Omar Kallas');

    INSERT INTO public.user_roles (user_id, role)
      VALUES (_omar_id, 'sales_manager')
      ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (NULL, 'system', 'user.approved', 'user_role', _omar_id::text,
              jsonb_build_object('role','sales_manager','reason','Phase B provisioning'));

    RAISE NOTICE 'Phase B: Omar Kallas (omar) → sales_manager, status=active.';
  END IF;

  -- Marie Falome — Business Development Manager
  IF _marie_id IS NOT NULL THEN
    UPDATE public.profiles
      SET status = 'active', full_name = 'Marie Falome'
      WHERE id = _marie_id AND (status <> 'active' OR full_name IS DISTINCT FROM 'Marie Falome');

    INSERT INTO public.user_roles (user_id, role)
      VALUES (_marie_id, 'bd_manager')
      ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (NULL, 'system', 'user.approved', 'user_role', _marie_id::text,
              jsonb_build_object('role','bd_manager','reason','Phase B provisioning'));

    RAISE NOTICE 'Phase B: Marie Falome (marie) → bd_manager, status=active.';
  END IF;

  -- Abdelrahman Jarrah — Salesperson
  IF _jarrah_id IS NOT NULL THEN
    UPDATE public.profiles
      SET status = 'active', full_name = 'Abdelrahman Jarrah'
      WHERE id = _jarrah_id AND (status <> 'active' OR full_name IS DISTINCT FROM 'Abdelrahman Jarrah');

    INSERT INTO public.user_roles (user_id, role)
      VALUES (_jarrah_id, 'salesperson')
      ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (NULL, 'system', 'user.approved', 'user_role', _jarrah_id::text,
              jsonb_build_object('role','salesperson','reason','Phase B provisioning'));

    RAISE NOTICE 'Phase B: Abdelrahman Jarrah (a.jarrah) → salesperson, status=active.';
  END IF;

  -- Faisal Abdulkadhar — Salesperson
  IF _fisal_id IS NOT NULL THEN
    UPDATE public.profiles
      SET status = 'active', full_name = 'Faisal Abdulkadhar'
      WHERE id = _fisal_id AND (status <> 'active' OR full_name IS DISTINCT FROM 'Faisal Abdulkadhar');

    INSERT INTO public.user_roles (user_id, role)
      VALUES (_fisal_id, 'salesperson')
      ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
      VALUES (NULL, 'system', 'user.approved', 'user_role', _fisal_id::text,
              jsonb_build_object('role','salesperson','reason','Phase B provisioning'));

    RAISE NOTICE 'Phase B: Faisal Abdulkadhar (fisal) → salesperson, status=active.';
  END IF;

  IF _any_missing THEN
    RAISE NOTICE 'Phase B: one or more invites still pending — re-run after all 6 users have signed up.';
  END IF;

  -- ── Step 2: Ensure Mohammed has system_admin ───────────────────────────────
  SELECT id INTO _mo_id FROM public.profiles WHERE email = 'moalagab@phc-sa.com' LIMIT 1;

  IF _mo_id IS NULL THEN
    -- A clean development/CI database has no production identities. Provisioning
    -- must therefore be repeatable without making the migration chain depend on
    -- pre-existing auth data.
    RAISE NOTICE 'Phase B: moalagab@phc-sa.com not found — skipping admin role cleanup (safe on dev/CI).';
  ELSE
    INSERT INTO public.user_roles (user_id, role)
      VALUES (_mo_id, 'system_admin')
      ON CONFLICT (user_id, role) DO NOTHING;

    RAISE NOTICE 'Phase B: moalagab system_admin confirmed.';

    -- ── Step 3: Remove Mohammed's legacy commercial roles ───────────────────
    --
    -- safe because step 1 already inserted Bassem (managing_director) and Omar
    -- (sales_manager) — protect_last_manager will find ≥1 holder of each role.
    -- sales_manager was already removed in Sprint 1E (migration 20260713130000).
    --
    -- Roles to clean up: ceo, bd_manager, viewer (whichever exist).

    DELETE FROM public.user_roles
      WHERE user_id = _mo_id
        AND role IN ('ceo', 'bd_manager', 'viewer');

    -- Audit the cleanup if any rows were actually deleted
    IF FOUND THEN
      INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
        VALUES (NULL, 'system', 'role.revoked', 'user_role', _mo_id::text,
                jsonb_build_object(
                  'roles_removed', ARRAY['ceo','bd_manager','viewer'],
                  'reason', 'Phase B — legacy commercial roles removed; moalagab retains system_admin only'
                ));
      RAISE NOTICE 'Phase B: legacy roles (ceo/bd_manager/viewer) removed from moalagab.';
    ELSE
      RAISE NOTICE 'Phase B: no legacy roles to remove from moalagab (already clean).';
    END IF;
  END IF;

END $$;

-- ── Verification query (run manually after applying) ──────────────────────
-- Expected: 7 rows, each with the correct role, status = active.
--
-- SELECT p.email, p.full_name, p.status, array_agg(ur.role ORDER BY ur.role) AS roles
-- FROM public.profiles p
-- LEFT JOIN public.user_roles ur ON ur.user_id = p.id
-- WHERE p.email IN (
--   'moalagab@phc-sa.com','mbassem@phc-sa.com','ahmad@phc-sa.com',
--   'omar@phc-sa.com','marie@phc-sa.com','a.jarrah@phc-sa.com','fisal@phc-sa.com'
-- )
-- GROUP BY p.email, p.full_name, p.status
-- ORDER BY p.email;
