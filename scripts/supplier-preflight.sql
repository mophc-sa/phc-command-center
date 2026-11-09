-- Supplier portal preflight: READ-ONLY catalog checks on schema public.
-- Run against production before the first supplier account (psql -f, or paste into the SQL editor).
-- Every section must return ZERO rows. A row is something a supplier session might reach;
-- stop and review it before creating any supplier account.
-- Mirrors supabase/tests/supplier_isolation_sweep.test.sql (sections 2-4); keep the lists in step.
begin;
set transaction read only;

-- 1. Tables and partitioned tables with row security off.
select '1 rls_disabled' as section, c.oid::regclass::text as object, null::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
 order by 2;

-- 2. Tables without the restrictive audit_session_boundary policy (profiles and user_roles carry their own
--    supplier rules and are excluded, as in the sweep test).
select '2 no_session_boundary' as section, c.oid::regclass::text as object, null::text as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname not in ('profiles', 'user_roles')
   and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = c.relname
                      and p.policyname = 'audit_session_boundary' and p.permissive = 'RESTRICTIVE'
                      and p.cmd = 'ALL' and p.qual ~ 'has_app_access')
 order by 2;

-- 3. Views selectable by authenticated or anon that run as the owner (not security_invoker), do not filter on
--    the caller, and are not on the reviewed list.
select '3 owner_run_view' as section, c.oid::regclass::text as object,
       concat_ws(',', case when has_table_privilege('authenticated', c.oid, 'SELECT') then 'authenticated' end,
                      case when has_table_privilege('anon', c.oid, 'SELECT') then 'anon' end) as detail
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('v', 'm')
   and (has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'SELECT'))
   and not coalesce('security_invoker=true' = any(c.reloptions), false)
   and pg_get_viewdef(c.oid) !~ '(auth\.uid|has_app_access|can_read|is_pricer|is_active_user|has_role|has_any_role)'
   and c.relname not in ('conversion_summary', 'loss_analysis', 'pricing_file_transitions',
                         'pricing_selling_totals', 'sales_forecast', 'team_performance')
 order by 2;

-- 4. SECURITY DEFINER functions executable by authenticated, anon or PUBLIC whose body checks no caller and
--    which are not in the known set (the sweep's reviewed signatures and the five supplier_portal_* functions).
with known(sig) as (values
  -- Sweep "answers" list (pure helpers, own rights, yes/no keyed by undisclosed ids).
  ('public.add_business_days(date,integer)'), ('public.historical_identity_text(text)'),
  ('public.historical_opportunity_identity(text,text,text,numeric,text)'), ('public.normalize_lead_key(text,text)'),
  ('public.normalize_vendor_name(text)'), ('public.opportunity_value(numeric,numeric,numeric)'),
  ('public.opportunity_win_weight(integer,win_confidence)'), ('public.parse_historical_sales_code(text)'),
  ('public.project_number_denied_message()'), ('public.riyadh_date(timestamp with time zone)'),
  ('public.pricing_my_rights()'), ('public.current_sla_days(sla_subject)'),
  ('public.ai_output_entity_still_owned(text,uuid,uuid)'), ('public.boq_revision_is_frozen(uuid)'),
  ('public.has_app_access(uuid)'), ('public.is_active_user(uuid)'), ('public.is_pricer(uuid)'),
  ('public.is_sales_contributor(uuid)'), ('public.has_role(uuid,app_role)'), ('public.has_any_role(uuid,app_role[])'),
  ('public.can_edit_total_value(uuid)'), ('public.can_read_attachments(uuid)'), ('public.can_read_commercial_cost(uuid)'),
  ('public.can_read_historical_sales(uuid)'), ('public.can_read_sales_analytics(uuid)'),
  ('public.can_set_pricing_margins(uuid)'), ('public.can_view_all_sales_data(uuid)'),
  ('public.can_edit_project_budget(uuid,uuid)'), ('public.can_read_activity(uuid,uuid,uuid,uuid,uuid,uuid,uuid)'),
  ('public.can_read_ai_recommendation(text,uuid,uuid)'), ('public.can_read_approval(uuid,uuid,uuid,uuid)'),
  ('public.can_read_boq(uuid,uuid)'), ('public.can_read_boq_revision(uuid,uuid)'),
  ('public.can_read_contract(uuid,uuid,uuid,uuid)'), ('public.can_read_document(uuid,uuid)'),
  ('public.can_read_opportunity_flag(text,uuid,uuid,uuid)'), ('public.can_read_opportunity_record(uuid,uuid)'),
  ('public.document_entity_grants(document_entity_type,uuid,uuid)'), ('public.storage_object_readable(text,text,uuid)'),
  -- Sweep reviewed SECURITY DEFINER list.
  ('public.ai_knowledge_source_current(text,uuid,timestamp with time zone)'), ('public.is_display_account(uuid)'),
  ('public.pricing_file_propose(uuid,numeric,numeric,text)'), ('public.project_has_valid_boq(uuid)'),
  ('public.source_is_approved_for_agents(text)')
), known_oids as (
  select to_regprocedure(sig) as oid from known
)
select '4 unchecked_security_definer' as section, p.oid::regprocedure::text as object,
       concat_ws(',', case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'authenticated' end,
                      case when has_function_privilege('anon', p.oid, 'EXECUTE') then 'anon' end,
                      case when exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                         where a.grantee = 0 and a.privilege_type = 'EXECUTE') then 'PUBLIC' end) as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
   and (has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))
   and not exists (select 1 from pg_depend d where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e')
   and p.prosrc !~* '(has_app_access|is_active_user|has_role|has_any_role|can_[a-z_]+\(|is_pricer|is_pipeline_operator|is_platform_admin|is_[a-z_]+_manager|_assert_|_supplier_session_vendor|_supplier_invitation_for_session|_supplier_account_manager|is_supplier_account)'
   and p.proname not in ('supplier_portal_confirmation', 'supplier_portal_file', 'supplier_portal_invitation',
                         'supplier_portal_invitations', 'supplier_portal_submit')
   and p.oid not in (select oid from known_oids where oid is not null)
 order by 2;

rollback;
