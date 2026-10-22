-- The info@ mailbox: who reads it, what is kept, and how a message becomes an
-- intake item, a reply on a deal, or a forward. Test user UUIDs use 2d…; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Users: a manager (pipeline operator), a rep (salesperson), a second rep, a
-- third rep who later leaves, an estimation manager, a BD manager and a
-- display account (viewer).
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000001','authenticated','authenticated','mgr+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000002','authenticated','authenticated','rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000003','authenticated','authenticated','rep2+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000004','authenticated','authenticated','rep3+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000005','authenticated','authenticated','est+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000006','authenticated','authenticated','bd+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000007','authenticated','authenticated','screen+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '2d000000-%';
update public.profiles set is_display_account = true where id = '2d000000-0000-0000-0000-000000000007';
insert into public.user_roles (user_id, role) values
  ('2d000000-0000-0000-0000-000000000001','sales_manager'),
  ('2d000000-0000-0000-0000-000000000002','salesperson'),
  ('2d000000-0000-0000-0000-000000000003','salesperson'),
  ('2d000000-0000-0000-0000-000000000004','salesperson'),
  ('2d000000-0000-0000-0000-000000000005','estimation_manager'),
  ('2d000000-0000-0000-0000-000000000006','bd_manager'),
  ('2d000000-0000-0000-0000-000000000007','viewer');

-- A client company owned by rep 1, with a contact.
insert into public.companies (id, name, account_owner_id, website_domain)
  values ('2d0000c0-0000-0000-0000-000000000001','Acme Build','2d000000-0000-0000-0000-000000000002','acme.example');
insert into public.contacts (id, name, email, company_id)
  values ('2d0000c1-0000-0000-0000-000000000001','Sara','sara@acme.example','2d0000c0-0000-0000-0000-000000000001');

-- 1-2. Owner rule
select is(public.info_mail_owner_for('Sara@Acme.example'), '2d000000-0000-0000-0000-000000000002'::uuid,
  'A known contact maps to the account owner');
select is(public.info_mail_owner_for('someone@gmail.com'), null::uuid, 'Free mail never maps to an owner');

-- 3. Two companies with different owners on one domain: no owner
insert into public.companies (id, name, account_owner_id, website_domain) values
  ('2d0000c0-0000-0000-0000-000000000002','Twin One','2d000000-0000-0000-0000-000000000002','twin.example'),
  ('2d0000c0-0000-0000-0000-000000000003','Twin Two','2d000000-0000-0000-0000-000000000003','twin.example');
select is(public.info_mail_owner_for('buyer@twin.example'), null::uuid,
  'Two companies on the sender''s domain give no owner');

-- 4. Body privacy CHECK
select throws_ok($$insert into public.info_mail (graph_message_id, received_at, category, body_text)
                   values ('g-hr', now(), 'hr', 'a CV')$$, '23514', null,
  'An HR message cannot keep its text');

-- Messages
insert into public.info_mail (id, graph_message_id, internet_message_id, conversation_id, from_email, from_name, subject, received_at, body_text, web_link) values
  ('2d0000a0-0000-0000-0000-000000000001','g-1','<m1@acme>','conv-1','sara@acme.example','Sara','RFQ - Diriyah villas', now(), 'Please quote signage for 40 villas in Diriyah. RFQ-ACM-77.', 'https://outlook.office365.com/owa/?ItemID=1'),
  ('2d0000a0-0000-0000-0000-000000000002','g-2','<m2@x>','conv-2','cv@gmail.com','Ali','CV - site engineer', now(), 'My CV', null),
  ('2d0000a0-0000-0000-0000-000000000003','g-3','<m3@y>','conv-3','buyer@unknown.example','Omar','Quotation request', now(), 'Need a price', null),
  ('2d0000a0-0000-0000-0000-000000000006','g-6','<m6@z>','conv-6','buyer@other.example','Lina','Tender for a mall', now(), 'Please quote the mall signage', null);

-- 5-7. Triage: a confident RFQ from a known client becomes an assigned intake item
select is(public.info_mail_apply_triage('2d0000a0-0000-0000-0000-000000000001','rfq',0.92,'Signage for 40 villas',
  '{"company":"Acme Build","project_name":"Diriyah villas","location":"Diriyah","client_rfq_ref":"RFQ-ACM-77","estimated_value":"1200000","scope":"Wayfinding signage"}'::jsonb),
  'intake_created', 'A confident RFQ creates an intake item');
select results_eq($$select source_type::text, assigned_owner_id, created_by, client_rfq_reference, location
                    from public.inbox_items i join public.info_mail m on m.inbox_item_id = i.id
                   where m.id = '2d0000a0-0000-0000-0000-000000000001'$$,
  $$values ('info_mailbox', '2d000000-0000-0000-0000-000000000002'::uuid, '2d000000-0000-0000-0000-000000000002'::uuid, 'RFQ-ACM-77', 'Diriyah')$$,
  'The item carries the extracted data and the account owner');
select ok(exists(select 1 from public.notifications where recipient_user_id = '2d000000-0000-0000-0000-000000000002'
                   and notification_type = 'intake_assigned'), 'The owner is notified');

-- 8-9. Non-request mail drops its text
select is(public.info_mail_apply_triage('2d0000a0-0000-0000-0000-000000000002','hr',0.95,'A CV for a site engineer post','null'::jsonb),
  'listed', 'An HR message is listed');
select is((select body_text from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000002'), null,
  'Its text is gone');

-- 10. An unsure request is listed with its text kept, and no item
select is(public.info_mail_apply_triage('2d0000a0-0000-0000-0000-000000000003','quotation_request',0.5,'Asks for a price','{}'::jsonb),
  'listed', 'Below 0.7 the request waits for a person');

-- 11. Triage runs once
select is(public.info_mail_apply_triage('2d0000a0-0000-0000-0000-000000000003','spam',0.9,'x','{}'::jsonb),
  'skipped', 'A classified message is not classified again');

-- 12. Three failed triage attempts drop the text
insert into public.info_mail (id, graph_message_id, received_at, body_text) values ('2d0000a0-0000-0000-0000-000000000004','g-4', now(), 'text');
select public.info_mail_triage_failed('2d0000a0-0000-0000-0000-000000000004');
select public.info_mail_triage_failed('2d0000a0-0000-0000-0000-000000000004');
select public.info_mail_triage_failed('2d0000a0-0000-0000-0000-000000000004');
select is((select body_text from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000004'), null,
  'After three failures the text is dropped');

-- 13-14. Clients cannot write; a rep cannot read mail that is not theirs
set local role authenticated;
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}';
select throws_ok($$insert into public.info_mail (graph_message_id, received_at) values ('g-x', now())$$, '42501', null,
  'Nobody writes info_mail from the browser');
select is((select count(*)::int from public.info_mail), 0, 'Rep 2 sees none of it');

-- 15. The routing rep reads the item's mail
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}';
select is((select count(*)::int from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000001'), 1,
  'The assigned rep reads the source email of their item');

-- 16. Only routers dismiss
select throws_ok($$select public.info_mail_dismiss('2d0000a0-0000-0000-0000-000000000003')$$, '42501', null,
  'A rep cannot dismiss info@ mail');

-- 17. A manager dismisses
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
select lives_ok($$select public.info_mail_dismiss('2d0000a0-0000-0000-0000-000000000003')$$, 'A manager can dismiss');
-- While the AI is down a router dismisses a message that is still unclassified.
select public.info_mail_dismiss('2d0000a0-0000-0000-0000-000000000006');
reset role;
-- Back to the service role with no signed-in user: emit_notification skips the
-- caller as a recipient, so a lingering manager identity would hide one notice.
set local request.jwt.claims = '{}';

-- 18-19. A late verdict never overrides the person who dismissed the message
select is(public.info_mail_apply_triage('2d0000a0-0000-0000-0000-000000000006','rfq',0.95,'Mall signage tender','{}'::jsonb),
  'listed', 'A confident RFQ verdict on a dismissed message only lists it');
select results_eq($$select status, inbox_item_id, category from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000006'$$,
  $$values ('dismissed', null::uuid, 'rfq')$$,
  'It stays dismissed with no intake item, and the verdict is recorded');

-- 20-21. A client reply on a converted item lands on the deal and notifies its people
insert into public.opportunities (id, project_name, stage, sales_stage, owner_id, company_id)
  values ('2d0000b0-0000-0000-0000-000000000001','Diriyah villas','quotation','rfq_received','2d000000-0000-0000-0000-000000000001','2d0000c0-0000-0000-0000-000000000001');
update public.inbox_items set status = 'converted', converted_record_type = 'opportunity', converted_record_id = '2d0000b0-0000-0000-0000-000000000001'
 where id = (select inbox_item_id from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000001');
update public.info_mail set opportunity_id = '2d0000b0-0000-0000-0000-000000000001' where id = '2d0000a0-0000-0000-0000-000000000001';
insert into public.info_mail (id, graph_message_id, internet_message_id, conversation_id, from_email, subject, received_at, body_text)
  values ('2d0000a0-0000-0000-0000-000000000005','g-5','<m5@acme>','conv-1','sara@acme.example','RE: RFQ - Diriyah villas', now(), 'Any update?');
select public.info_mail_record_reply('2d0000a0-0000-0000-0000-000000000005','2d0000a0-0000-0000-0000-000000000001');
select ok(exists(select 1 from public.activities where related_opportunity_id = '2d0000b0-0000-0000-0000-000000000001'
                   and activity_type = 'email_received' and provider_message_id = 'imid:<m5@acme>'), 'The reply is on the deal');
select is((select count(distinct recipient_user_id)::int from public.notifications where notification_type = 'client_reply'), 2,
  'The deal owner and the item owner are told');

-- 22-23. A reply on a deal whose owner has left reaches an active sales manager
insert into public.opportunities (id, project_name, stage, sales_stage, owner_id)
  values ('2d0000b0-0000-0000-0000-000000000002','Mall signage','quotation','rfq_received','2d000000-0000-0000-0000-000000000004');
update public.profiles set status = 'suspended' where id = '2d000000-0000-0000-0000-000000000004';
insert into public.info_mail (id, graph_message_id, conversation_id, from_email, subject, received_at, category, status, opportunity_id) values
  ('2d0000a0-0000-0000-0000-000000000007','g-7','conv-7','buyer@mall.example','Mall signage', now(), 'rfq', 'intake_created', '2d0000b0-0000-0000-0000-000000000002');
insert into public.info_mail (id, graph_message_id, internet_message_id, conversation_id, from_email, subject, received_at, body_text)
  values ('2d0000a0-0000-0000-0000-000000000008','g-8','<m8@mall>','conv-7','buyer@mall.example','RE: Mall signage', now(), 'Any news?');
select public.info_mail_record_reply('2d0000a0-0000-0000-0000-000000000008','2d0000a0-0000-0000-0000-000000000007');
select is((select count(*)::int from public.notifications where notification_type = 'client_reply'
            and entity_id = '2d0000b0-0000-0000-0000-000000000002' and recipient_user_id = '2d000000-0000-0000-0000-000000000004'), 0,
  'The inactive owner gets nothing');
select ok(exists(select 1 from public.notifications where notification_type = 'client_reply'
                   and entity_id = '2d0000b0-0000-0000-0000-000000000002' and recipient_user_id = '2d000000-0000-0000-0000-000000000001'),
  'An active sales manager is told instead');

-- 24-25. Linking a conversion: an item with no owner and no creator
insert into public.info_mail (id, graph_message_id, from_email, subject, received_at, category, body_text)
  values ('2d0000a0-0000-0000-0000-000000000009','g-9','buyer@nobody.example','Kiosk signage', now(), 'rfq', 'Quote 3 kiosks');
select isnt(public.info_mail_create_intake('2d0000a0-0000-0000-0000-000000000009','{}'::jsonb), null::uuid,
  'An unknown sender''s request becomes an item with no owner');
update public.inbox_items set status = 'converted', converted_record_type = 'opportunity', converted_record_id = '2d0000b0-0000-0000-0000-000000000001'
 where id = (select inbox_item_id from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000009');
-- The rep cannot read that mail, so the item id goes through a setting.
select set_config('test.item9', (select inbox_item_id::text from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000009'), true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}';
select throws_ok($$select public.info_mail_link_conversion(current_setting('test.item9')::uuid)$$,
  '42501', null, 'An unrelated rep cannot link an ownerless item''s mail');
reset role;

-- Back to the service role with no signed-in user.
set local request.jwt.claims = '{}';

-- 26. The pass's state row starts empty: no first pass, no back-off.
select results_eq($$select started_at, triage_retry_at, triage_backoff_minutes from public.info_mailbox_state$$,
  $$values (null::timestamptz, null::timestamptz, 0)$$,
  'The mailbox state starts with no first pass and no back-off');

-- Claimed rows: a forward in flight (handled_at under five minutes, still new).
insert into public.info_mail (id, graph_message_id, from_email, subject, received_at, body_text, handled_by, handled_at) values
  ('2d0000a0-0000-0000-0000-000000000010','g-10','buyer@claimed.example','Tender (claimed)', now(), 'Quote please', '2d000000-0000-0000-0000-000000000001', now() - interval '1 minute'),
  ('2d0000a0-0000-0000-0000-000000000011','g-11','buyer@stale.example','Tender (stale claim)', now(), 'Quote please', '2d000000-0000-0000-0000-000000000001', now() - interval '10 minutes'),
  ('2d0000a0-0000-0000-0000-000000000012','g-12','buyer@stale2.example','Tender (stale claim 2)', now(), 'Quote please', '2d000000-0000-0000-0000-000000000001', now() - interval '10 minutes'),
  ('2d0000a0-0000-0000-0000-000000000020','g-20','buyer@claimed2.example','Tender (claimed 2)', now(), 'Quote please', '2d000000-0000-0000-0000-000000000001', now() - interval '1 minute');
insert into public.info_mail (id, graph_message_id, from_email, subject, received_at, category, body_text) values
  ('2d0000a0-0000-0000-0000-000000000013','g-13','sara@acme.example','RE: something', now(), 'client_reply', 'A reply');

-- 27-29. A claimed row: promote refuses it, triage records the verdict but makes no item
select throws_ok($$select public.info_mail_promote('2d0000a0-0000-0000-0000-000000000010','2d000000-0000-0000-0000-000000000001','Full text')$$,
  'P0002', 'This message was already handled', 'Promote refuses a claimed message');
select is(public.info_mail_apply_triage('2d0000a0-0000-0000-0000-000000000010','rfq',0.95,'A tender','{}'::jsonb),
  'listed', 'A confident RFQ verdict on a claimed message only lists it');
select results_eq($$select status, inbox_item_id, category from public.info_mail where id = '2d0000a0-0000-0000-0000-000000000010'$$,
  $$values ('new', null::uuid, 'rfq')$$, 'The claimed message keeps no item and records the verdict');

-- 30. A stale claim may be promoted
select isnt(public.info_mail_promote('2d0000a0-0000-0000-0000-000000000012','2d000000-0000-0000-0000-000000000001','Full text'), null::uuid,
  'A claim older than five minutes is stale: promote takes it');

-- 31. Promote refuses a client reply
select throws_ok($$select public.info_mail_promote('2d0000a0-0000-0000-0000-000000000013','2d000000-0000-0000-0000-000000000001','Full text')$$,
  'P0002', 'This message was already handled', 'Promote refuses a client reply');

-- 32-33. A manager cannot dismiss a claimed message, but can take a stale claim
set local role authenticated;
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
select throws_ok($$select public.info_mail_dismiss('2d0000a0-0000-0000-0000-000000000020')$$,
  'P0002', 'This message was already handled', 'Dismiss refuses a claimed message');
select lives_ok($$select public.info_mail_dismiss('2d0000a0-0000-0000-0000-000000000011')$$,
  'Dismiss takes a stale claim');
reset role;
set local request.jwt.claims = '{}';

-- 34. A recorded forward tells the recipient
insert into public.info_mail (id, graph_message_id, from_email, subject, received_at) values
  ('2d0000a0-0000-0000-0000-000000000014','g-14','vendor@supply.example','Price list', now());
select public.info_mail_record_forward('2d0000a0-0000-0000-0000-000000000014','2d000000-0000-0000-0000-000000000003','2d000000-0000-0000-0000-000000000001');
select ok(exists(select 1 from public.notifications where recipient_user_id = '2d000000-0000-0000-0000-000000000003'
                   and notification_type = 'info_mail_forwarded' and dedupe_key like '%2d0000a0-0000-0000-0000-000000000014%'),
  'The forward recipient is told');

-- 35. A reply keeps a router's decision; a new one becomes attached
insert into public.info_mail (id, graph_message_id, internet_message_id, conversation_id, from_email, subject, received_at, status, handled_by, handled_at) values
  ('2d0000a0-0000-0000-0000-000000000015','g-15','<m15@acme>','conv-1','sara@acme.example','RE: RE: RFQ', now(), 'dismissed', '2d000000-0000-0000-0000-000000000001', now());
select public.info_mail_record_reply('2d0000a0-0000-0000-0000-000000000015','2d0000a0-0000-0000-0000-000000000001');
select results_eq($$select id::text, status, category from public.info_mail
                     where id in ('2d0000a0-0000-0000-0000-000000000005','2d0000a0-0000-0000-0000-000000000015') order by id$$,
  $$values ('2d0000a0-0000-0000-0000-000000000005', 'attached', 'client_reply'),
           ('2d0000a0-0000-0000-0000-000000000015', 'dismissed', 'client_reply')$$,
  'A dismissed message stays dismissed when it turns out to be a reply');

-- 36-38. Linking a conversion puts earlier client replies on the deal
insert into public.info_mail (id, graph_message_id, internet_message_id, conversation_id, from_email, from_name, subject, received_at, category, body_text) values
  ('2d0000a0-0000-0000-0000-000000000016','g-16','<m16@acme>','conv-16','sara@acme.example','Sara','RFQ - Qiddiya kiosks', now() - interval '2 days', 'rfq', 'Quote 12 kiosks');
select set_config('test.item16', public.info_mail_create_intake('2d0000a0-0000-0000-0000-000000000016','{}'::jsonb)::text, true);
insert into public.info_mail (id, graph_message_id, internet_message_id, conversation_id, from_email, subject, received_at, body_text) values
  ('2d0000a0-0000-0000-0000-000000000017','g-17','<m17@acme>','conv-16','sara@acme.example','RE: RFQ - Qiddiya kiosks', now() - interval '1 day', 'Drawings attached');
select public.info_mail_record_reply('2d0000a0-0000-0000-0000-000000000017','2d0000a0-0000-0000-0000-000000000016');
insert into public.opportunities (id, project_name, stage, sales_stage, owner_id, company_id)
  values ('2d0000b0-0000-0000-0000-000000000003','Qiddiya kiosks','quotation','rfq_received','2d000000-0000-0000-0000-000000000002','2d0000c0-0000-0000-0000-000000000001');
update public.inbox_items set status = 'converted', converted_record_type = 'opportunity', converted_record_id = '2d0000b0-0000-0000-0000-000000000003'
 where id = current_setting('test.item16')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}';
select is(public.info_mail_link_conversion(current_setting('test.item16')::uuid), 2, 'The item''s two messages are bound to the deal');
select is(public.info_mail_link_conversion(current_setting('test.item16')::uuid), 0, 'Linking again binds nothing');
reset role;
set local request.jwt.claims = '{}';
select results_eq($$select activity_type::text, owner_id, left(draft_content, 20), email_from from public.activities
                     where related_opportunity_id = '2d0000b0-0000-0000-0000-000000000003'$$,
  $$values ('email_received', '2d000000-0000-0000-0000-000000000002'::uuid, 'Drawings attached', 'sara@acme.example')$$,
  'The earlier client reply is now on the deal, once');

-- 39-41. Newsletters and spam: only routers clear them, and a claimed one stays
insert into public.info_mail (id, graph_message_id, from_email, subject, received_at, category, handled_by, handled_at) values
  ('2d0000a0-0000-0000-0000-000000000018','g-18','news@letter.example','Weekly news', now(), 'spam', null, null),
  ('2d0000a0-0000-0000-0000-000000000019','g-19','promo@letter.example','Offer', now(), 'spam', '2d000000-0000-0000-0000-000000000001', now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}';
select throws_ok($$select public.info_mail_dismiss_spam()$$, '42501', null, 'A rep cannot clear the spam');
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
select is(public.info_mail_dismiss_spam(), 1, 'A manager clears the open spam');
reset role;
set local request.jwt.claims = '{}';
select results_eq($$select id::text, status, handled_by from public.info_mail
                     where id in ('2d0000a0-0000-0000-0000-000000000018','2d0000a0-0000-0000-0000-000000000019') order by id$$,
  $$values ('2d0000a0-0000-0000-0000-000000000018', 'dismissed', '2d000000-0000-0000-0000-000000000001'::uuid),
           ('2d0000a0-0000-0000-0000-000000000019', 'new', '2d000000-0000-0000-0000-000000000001'::uuid)$$,
  'Only the unclaimed spam is dismissed, by the manager');

-- 42-45. Mentions reach only people who can open the deal (deal 3 is rep 1's)
insert into public.activities (id, activity_type, summary, related_opportunity_id, sent_by, owner_id, created_by)
  values ('2d0000d0-0000-0000-0000-000000000001','email_draft','Revised quote sent','2d0000b0-0000-0000-0000-000000000003',
          '2d000000-0000-0000-0000-000000000002','2d000000-0000-0000-0000-000000000002','2d000000-0000-0000-0000-000000000002');
set local role authenticated;
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1"}';
select is(public.notify_mentions('2d0000d0-0000-0000-0000-000000000001', array[
    '2d000000-0000-0000-0000-000000000002',  -- self
    '2d000000-0000-0000-0000-000000000003',  -- another rep: cannot open the deal
    '2d000000-0000-0000-0000-000000000005',  -- estimation manager: cannot open the deal
    '2d000000-0000-0000-0000-000000000006'   -- BD manager: can
  ]::uuid[]), 1, 'Only the colleague who can open the deal is notified');
select throws_ok($$select public.notify_mentions('2d0000d0-0000-0000-0000-000000000001',
    array_fill('2d000000-0000-0000-0000-000000000006'::uuid, array[11]))$$, '22023', null, 'More than ten mentions are refused');
select set_eq($$select id from public.mentionable_colleagues('2d0000b0-0000-0000-0000-000000000003') where id::text like '2d000000-%'$$,
  $$values ('2d000000-0000-0000-0000-000000000001'::uuid), ('2d000000-0000-0000-0000-000000000006'::uuid)$$,
  'The picker offers active colleagues who can open the deal, not the caller, the estimator or the display account');
set local request.jwt.claims = '{"sub":"2d000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1"}';
select is((select count(*)::int from public.mentionable_colleagues('2d0000b0-0000-0000-0000-000000000003')), 0,
  'A rep who cannot open the deal gets nobody');
reset role;
set local request.jwt.claims = '{}';

-- 46. The mention went to the BD manager only
select set_eq($$select recipient_user_id from public.notifications where notification_type = 'mention'$$,
  $$values ('2d000000-0000-0000-0000-000000000006'::uuid)$$, 'Only the BD manager got a mention notice');

-- 47-48. Grants on the new functions
select results_eq($$select has_function_privilege('authenticated', 'public.info_mail_dismiss_spam()', 'execute'),
                           has_function_privilege('anon', 'public.info_mail_dismiss_spam()', 'execute'),
                           has_function_privilege('authenticated', 'public.mentionable_colleagues(uuid)', 'execute'),
                           has_function_privilege('anon', 'public.mentionable_colleagues(uuid)', 'execute')$$,
  $$values (true, false, true, false)$$, 'The two router/picker RPCs are for signed-in users only');
select results_eq($$select has_function_privilege('authenticated', 'public.can_open_opportunity(uuid, uuid)', 'execute'),
                           has_function_privilege('anon', 'public.can_open_opportunity(uuid, uuid)', 'execute')$$,
  $$values (false, false)$$, 'The deal-access helper is internal');

select * from finish();
rollback;
