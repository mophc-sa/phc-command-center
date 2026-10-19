-- Overdue notifications are typed by what the flag is linked to (2026-10-19:
-- an RFQ flag typed 'opportunity' opened /opportunities/<rfq id> — not found).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(4);
INSERT INTO auth.users(id,email) VALUES ('b2000000-0000-4000-8000-000000000001','ci-overdue-owner@phc-sa.com');
UPDATE public.profiles SET status='active' WHERE id='b2000000-0000-4000-8000-000000000001';

INSERT INTO public.opportunity_flags
  (id, linked_record_type, linked_record_id, flag_kind, action_owner_id, due_date, priority, status, reason, queue_action_type, condition_key)
VALUES
  ('b2000000-0000-4000-8000-0000000000f1','rfq','b2000000-0000-4000-8000-0000000000a1','action_required',
   'b2000000-0000-4000-8000-000000000001', CURRENT_DATE - 1,'A','open','Submission due',NULL,'ci-rfq'),
  ('b2000000-0000-4000-8000-0000000000f2','opportunity','b2000000-0000-4000-8000-0000000000a2','action_required',
   'b2000000-0000-4000-8000-000000000001', CURRENT_DATE - 1,'A','open','Chase the client',NULL,'ci-opp');

SELECT ok(public.notify_overdue_items() >= 2, 'Both lapsed flags notify');
SELECT is((SELECT entity_type FROM public.notifications
            WHERE dedupe_key LIKE 'overdue:b2000000-0000-4000-8000-0000000000f1:%'),
          'rfq', 'An RFQ flag is notified as an RFQ');
SELECT is((SELECT metadata->>'opportunity_id' FROM public.notifications
            WHERE dedupe_key LIKE 'overdue:b2000000-0000-4000-8000-0000000000f2:%'),
          'b2000000-0000-4000-8000-0000000000a2', 'An opportunity flag names the deal in metadata');
SELECT is((SELECT metadata FROM public.notifications
            WHERE dedupe_key LIKE 'overdue:b2000000-0000-4000-8000-0000000000f1:%'),
          NULL::jsonb, 'A non-deal flag claims no deal');
SELECT * FROM finish();
ROLLBACK;
