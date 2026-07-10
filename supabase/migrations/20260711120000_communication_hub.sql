-- =========================================================
-- Sales OS pilot — Sprint: Communication Hub Phase 1.
--
-- Reuses the existing public.activities table as the communication log
-- rather than creating a parallel "communication_activities" table from
-- scratch. It already models exactly this: activity_type already has
-- email_draft | whatsapp_draft | call | meeting | visit | note, and
-- activity_status already has draft | logged | sent. It's read by
-- my-workspace.tsx and written by logActivity()/logOutlookComposeOpened()
-- today. Renaming the table would be purely cosmetic and would break every
-- existing caller/policy for zero functional gain, so instead this
-- migration extends it additively:
--   - related_rfq_id / related_tender_id: activities could previously only
--     link to an opportunity/company/contact. RFQs and tenders exist BEFORE
--     an opportunity is created (pre-conversion), so a communication logged
--     from the RFQ/Tender board had nowhere real to attach — this was a
--     genuine gap, not a design choice. Fixed here.
--   - template_id: which communication_templates row (if any) produced the
--     draft, for traceability.
--   - sent_at / sent_by: Phase 1 never sends automatically, but the user can
--     click "Mark as Sent" after actually sending via Outlook/WhatsApp
--     themselves — these two columns record that human action.
--
-- Unlike related_opportunity_id (ON DELETE CASCADE, an earlier design
-- choice), the two new record FKs use ON DELETE SET NULL: deleting an RFQ
-- or tender later shouldn't erase the historical fact that a communication
-- happened — only its direct link.
--
-- communication_templates is genuinely new — nothing like it existed. It is
-- the reusable-message store for the new WhatsApp click-to-chat flow.
-- Email keeps using the existing, already-working src/lib/email-templates.ts
-- (pure TS functions, already wired to 2 pages, no reason to disturb a
-- working system in Phase 1) — this table is additive infrastructure for
-- channels that had nothing before, not a forced migration of email.
-- =========================================================

-- ---- 1. communication_templates (new) ----------------------------------
CREATE TABLE public.communication_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel public.activity_type NOT NULL, -- constrained below to email_draft | whatsapp_draft only
  name TEXT NOT NULL,
  subject TEXT,               -- email only; ignored for whatsapp_draft
  body TEXT NOT NULL,         -- supports {{placeholder}} tokens, substituted client-side
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT communication_templates_channel_check CHECK (channel IN ('email_draft', 'whatsapp_draft')),
  CONSTRAINT communication_templates_channel_name_key UNIQUE (channel, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.communication_templates TO authenticated;
GRANT ALL ON public.communication_templates TO service_role;
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Communication templates readable" ON public.communication_templates
  FOR SELECT TO authenticated USING (true);
-- Template curation is a manager-level responsibility (shared, org-wide
-- messaging content) — narrower than the general "sales team" write access
-- used elsewhere on this table's sibling, activities. Salespeople can read
-- and use templates but not add/edit/delete them.
CREATE POLICY "Communication templates editable by managers" ON public.communication_templates
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager','bd_manager']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['system_admin','managing_director','general_manager','ceo','sales_manager','bd_manager']::public.app_role[]));
CREATE TRIGGER trg_communication_templates_updated_at BEFORE UPDATE ON public.communication_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_communication_templates_channel ON public.communication_templates(channel) WHERE is_active;

-- Seed starter WhatsApp templates (email already has its own set in code).
-- ON CONFLICT (channel, name) DO UPDATE, not DO NOTHING: rerunning this file
-- manually against an already-migrated database must not create duplicates,
-- and if the starter copy is corrected here later, re-applying should also
-- refresh the stored body rather than leave the old wording stuck forever.
INSERT INTO public.communication_templates (channel, name, body) VALUES
  ('whatsapp_draft', 'Follow-up — general',
   'Hi {{contact_name}}, following up on {{record_name}} from PHC. Could we get an update on next steps?'),
  ('whatsapp_draft', 'Quotation follow-up',
   'Hi {{contact_name}}, checking in on the quotation for {{record_name}}. Happy to answer any questions.'),
  ('whatsapp_draft', 'Meeting request',
   'Hi {{contact_name}}, could we schedule a short call about {{record_name}} this week?')
ON CONFLICT (channel, name) DO UPDATE SET body = EXCLUDED.body, updated_at = now();

-- ---- 2. Extend activities (the communication log) -----------------------
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS related_rfq_id UUID REFERENCES public.rfqs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS related_tender_id UUID REFERENCES public.tenders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.communication_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_activities_rfq ON public.activities(related_rfq_id);
CREATE INDEX IF NOT EXISTS idx_activities_tender ON public.activities(related_tender_id);
CREATE INDEX IF NOT EXISTS idx_activities_company ON public.activities(company_id);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON public.activities(contact_id);

NOTIFY pgrst, 'reload schema';
