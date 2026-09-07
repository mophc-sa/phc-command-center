BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(4);
INSERT INTO auth.users(id,email) VALUES
 ('b1000000-0000-4000-8000-000000000001','ci-notification-one@phc-sa.com'),
 ('b1000000-0000-4000-8000-000000000002','ci-notification-two@phc-sa.com');
UPDATE public.profiles SET status='active' WHERE id IN ('b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002');
INSERT INTO public.notifications(recipient_user_id,notification_type,entity_type,title,source_event,dedupe_key)
VALUES ('b1000000-0000-4000-8000-000000000001','test','system','one','test','one'),
 ('b1000000-0000-4000-8000-000000000002','test','system','two','test','two');
SELECT ok(has_table_privilege('authenticated','public.notifications','SELECT'),'Authenticated API has an explicit read grant');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT is((SELECT count(*)::int FROM public.notifications),1,'Recipient can read only own notification');
SELECT is((SELECT count(*)::int FROM public.notifications WHERE recipient_user_id='b1000000-0000-4000-8000-000000000002'),0,'Another recipient stays private');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET status='suspended' WHERE id='b1000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","aal":"aal1"}',true);
SELECT is((SELECT count(*)::int FROM public.notifications),0,'Suspended recipient cannot read notifications');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
