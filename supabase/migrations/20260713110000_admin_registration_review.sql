-- =========================================================
-- Sprint 1C: Admin Registration Review
--
-- Problem (B-04, m-03):
--   - /admin-settings had no route guard — any authenticated
--     user could navigate there and see all team data.
--   - Admins had no DB-level permission to update profile.status
--     for other users, so the approve/reject workflow (Sprint 1C
--     app layer) would have been silently rejected by RLS.
--
-- What this migration does:
--   1. Adds a second UPDATE policy on profiles that allows team
--      managers (system_admin + commercial managers) to update any
--      user's profile — enabling approve/reject/suspend/activate.
--   2. Preserves the existing self-update policy so users can still
--      update their own profile (language, avatar, etc.).
-- =========================================================

-- Allow team managers to update any user's profile.
-- The existing "Users update own profile" policy (auth.uid() = id)
-- continues to cover self-updates. RLS policies are OR-combined, so
-- both policies can trigger simultaneously without conflict.
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
CREATE POLICY "Admins can update any profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    public.has_any_role(
      auth.uid(),
      ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']
        ::public.app_role[]
    )
  )
  WITH CHECK (
    public.has_any_role(
      auth.uid(),
      ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager']
        ::public.app_role[]
    )
  );
