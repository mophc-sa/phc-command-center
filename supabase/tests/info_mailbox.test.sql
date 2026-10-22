-- The info@ mailbox: who reads it, what is kept, and how a message becomes an
-- intake item, a reply on a deal, or a forward. Test user UUIDs use 2d…; rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Users: a manager (pipeline operator), a rep (salesperson), a second rep, a
-- third rep who later leaves.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000001','authenticated','authenticated','mgr+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000002','authenticated','authenticated','rep+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000003','authenticated','authenticated','rep2+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','2d000000-0000-0000-0000-000000000004','authenticated','authenticated','rep3+test@phc-sa.com',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
update public.profiles set status = 'active' where id::text like '2d000000-%';
insert into public.user_roles (user_id, role) values
  ('2d000000-0000-0000-0000-000000000001','sales_manager'),
  ('2d000000-0000-0000-0000-000000000002','salesperson'),
  ('2d000000-0000-0000-0000-000000000003','salesperson'),
  ('2d000000-0000-0000-0000-000000000004','salesperson');

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

select * from finish();
rollback;
