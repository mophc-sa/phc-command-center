-- =========================================================
-- Discussion becomes editable/deletable by its author (or system_admin),
-- and gains an optional @mention for review/approval/endorsement —
-- reversing the earlier "immutable log" decision per explicit 2026-08-03
-- client direction. The mention reuses the existing `approvals` table
-- (assigned_approver) so the mentioned person sees it through the
-- already-wired NotificationCenter / my-workspace "my approvals" paths —
-- no new notification infrastructure needed.
-- =========================================================

ALTER TABLE public.opportunity_discussions
  ADD COLUMN IF NOT EXISTS mentioned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mention_purpose TEXT
    CHECK (mention_purpose IS NULL OR mention_purpose IN ('review', 'approval', 'endorsement')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TRIGGER trg_opportunity_discussions_updated_at BEFORE UPDATE ON public.opportunity_discussions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Previously REVOKEd entirely (no UPDATE/DELETE grant at all). Grant it
-- back and gate with RLS: only the post's own author, or system_admin.
GRANT UPDATE, DELETE ON public.opportunity_discussions TO authenticated;

CREATE POLICY "Discussion editable by author or admin" ON public.opportunity_discussions
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]))
  WITH CHECK (created_by = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]));

CREATE POLICY "Discussion deletable by author or admin" ON public.opportunity_discussions
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['system_admin']::public.app_role[]));
