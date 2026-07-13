-- =========================================================
-- Sprint 1B: User Status Quarantine
--
-- Problem (B-02, B-03, M-01, M-02, M-04):
--   Every self-registrant was immediately granted the `viewer`
--   role and could SELECT all CRM data via USING (true) RLS
--   policies. No approval gate existed.
--
-- What this migration does:
--   1. Creates user_status enum (pending_approval | active | suspended)
--   2. Adds `status` column to profiles (default pending_approval)
--   3. Backfills all existing users as `active` — they pre-date
--      the approval workflow and must keep working.
--   4. Creates is_active_user() SECURITY DEFINER helper
--   5. Updates profiles SELECT policy — pending users can read
--      their own row (needed for the beforeLoad status check),
--      active users can read all rows.
--   6. Updates ALL business table SELECT USING (true) policies to
--      require is_active_user(auth.uid()) via a pg_policies scan.
--      This is intentionally table-agnostic: any future migration
--      that adds USING (true) SELECT policy without a status check
--      will be caught by the Sprint 1F UAT tests.
--   7. Rewrites handle_new_user() — removes the immediate viewer
--      grant. New users get a profile but no role until an admin
--      approves them (Sprint 1C).
-- =========================================================

-- ── 1. Enum ──────────────────────────────────────────────
CREATE TYPE public.user_status AS ENUM (
  'pending_approval',
  'active',
  'suspended'
);

-- ── 2. Column ────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN status public.user_status NOT NULL DEFAULT 'pending_approval';

-- ── 3. Backfill existing users ────────────────────────────
-- All users who registered before this migration are already
-- vetted (production database) — mark them active immediately.
-- New registrations will default to pending_approval.
UPDATE public.profiles SET status = 'active';

-- ── 4. is_active_user() helper ────────────────────────────
-- Called inside RLS USING clauses. SECURITY DEFINER avoids
-- the need for the calling session to have direct SELECT on
-- profiles within a policy evaluation context.
CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND status = 'active'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_active_user(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_active_user(uuid) TO authenticated;

-- ── 5. Profiles SELECT policy (special case) ─────────────
-- Pending users must be able to read their own profile so the
-- app's beforeLoad can fetch their status and redirect them to
-- /pending-approval. Active users can read all profiles (team
-- visibility needed for assignment dropdowns etc.).
DROP POLICY IF EXISTS "Profiles readable by authenticated" ON public.profiles;
CREATE POLICY "Profiles readable by self or active user" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_active_user(auth.uid()));

-- ── 6. Business table SELECT policies ────────────────────
-- Replace every USING (true) SELECT policy on every table in
-- the public schema (except profiles, handled above) with one
-- that requires the caller to be an active user.
-- pg_policies.qual stores the decompiled USING expression;
-- for `USING (true)` it is the string 'true'.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname   = 'public'
      AND cmd          = 'SELECT'
      AND qual         = 'true'
      AND tablename   <> 'profiles'   -- handled separately above
      AND roles        = '{authenticated}'::name[]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      pol.policyname, pol.tablename
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()))',
      pol.policyname, pol.tablename
    );
  END LOOP;
END $$;

-- ── 7. handle_new_user() — remove immediate viewer grant ──
-- Previous version inserted a viewer row unconditionally.
-- Now new users get a profile with status=pending_approval and
-- NO role. An admin must approve them (Sprint 1C) before they
-- can access any data.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'pending_approval'
  )
  ON CONFLICT (id) DO NOTHING;
  -- NOTE: The viewer role INSERT that existed here has been removed.
  -- Roles are granted by an admin after account approval (Sprint 1C).
  RETURN NEW;
END;
$$;
