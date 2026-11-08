-- =============================================================================
-- Pricing loop PR 3, part 1: supplier accounts and the boundary around them.
--
-- A supplier is an external account linked to one vendors row. It reaches the
-- supplier portal's functions and nothing else. The boundary is has_app_access:
-- every public table carries the restrictive audit_session_boundary policy
-- built on it (20260928100000, and section 7 below for the tables made since),
-- storage.objects carries it, and every role predicate (has_role,
-- is_active_user, is_pricer, can_read_commercial_cost, ...) goes through it for
-- the caller. A supplier now fails it, so it reads and writes nothing through
-- PostgREST. The portal (later migrations) is SECURITY DEFINER functions that
-- start from _supplier_session_vendor() instead.
-- =============================================================================

-- 1. The vendor a supplier account prices for.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS profiles_vendor ON public.profiles (vendor_id) WHERE vendor_id IS NOT NULL;
COMMENT ON COLUMN public.profiles.vendor_id IS
  'Supplier accounts only: the vendor this account prices for. Set by supplier_account_activate; nobody edits it directly.';

-- Only supplier_account_activate sets it (transaction-local flag naming the profile).
CREATE OR REPLACE FUNCTION public.profiles_vendor_link_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF ((TG_OP = 'INSERT' AND NEW.vendor_id IS NOT NULL)
      OR (TG_OP = 'UPDATE' AND NEW.vendor_id IS DISTINCT FROM OLD.vendor_id))
     AND coalesce(current_setting('phc.supplier_account_link', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'A supplier account''s vendor is set when the account is created. | يُحدَّد مورد الحساب عند إنشائه.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_vendor_link_guard ON public.profiles;
CREATE TRIGGER profiles_vendor_link_guard BEFORE INSERT OR UPDATE OF vendor_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_vendor_link_guard();

-- 2. Who is a supplier, and which vendor the current session prices for.
CREATE OR REPLACE FUNCTION public.is_supplier_account(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'supplier'::public.app_role);
$$;
REVOKE ALL ON FUNCTION public.is_supplier_account(uuid) FROM PUBLIC, anon, authenticated;

-- An active supplier account with a vendor, signed in with MFA (aal2). NULL for
-- anyone else. Every portal function starts here.
CREATE OR REPLACE FUNCTION public._supplier_session_vendor()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.vendor_id FROM public.profiles p
   WHERE p.id = auth.uid() AND p.status = 'active' AND p.vendor_id IS NOT NULL
     AND public.is_supplier_account(p.id)
     AND coalesce(auth.jwt()->>'aal', '') = 'aal2';
$$;
REVOKE ALL ON FUNCTION public._supplier_session_vendor() FROM PUBLIC, anon, authenticated;

-- 3. A supplier never has app access. Same body as 20261104120000 plus the supplier line.
CREATE OR REPLACE FUNCTION public.has_app_access(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND status = 'active')
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'supplier')
    AND (NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id
      AND role IN ('general_manager','finance_manager','sales_manager','system_admin','managing_director')
    ) OR (auth.uid() = _user_id AND auth.jwt()->>'aal' = 'aal2')), false);
$$;
REVOKE ALL ON FUNCTION public.has_app_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_app_access(uuid) TO authenticated, service_role;

-- 4. The supplier role stands alone and always has its vendor.
CREATE OR REPLACE FUNCTION public.user_roles_supplier_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'supplier' THEN
    IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = NEW.user_id AND r.role <> 'supplier') THEN
      RAISE EXCEPTION 'A supplier account holds no other role. | حساب المورد لا يحمل دوراً آخر.' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.vendor_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Supplier accounts are created from the pricing file, linked to a supplier. | حسابات الموردين تُنشأ من ملف التسعير مربوطة بمورد.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = NEW.user_id AND r.role = 'supplier') THEN
    RAISE EXCEPTION 'A supplier account holds no other role. | حساب المورد لا يحمل دوراً آخر.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS user_roles_supplier_guard ON public.user_roles;
CREATE TRIGGER user_roles_supplier_guard BEFORE INSERT OR UPDATE OF role, user_id ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_supplier_guard();

-- 5. auth.users takes a non-PHC address only for a supplier account that the
-- supplier-account action (sales-os-api) is creating right now: a pricer's
-- request row (supplier_account_prepare), named in app_metadata, which only
-- the service role can set. A sign-up from the app cannot set app_metadata.
CREATE TABLE IF NOT EXISTS public.supplier_account_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  email       text NOT NULL,
  full_name   text NOT NULL,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  consumed_at timestamptz,
  CONSTRAINT sai_email_clean CHECK (email = lower(btrim(email)) AND char_length(email) <= 254
                                    AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT sai_name CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 200)
);
ALTER TABLE public.supplier_account_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_account_invites FROM anon, authenticated;
GRANT ALL ON public.supplier_account_invites TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_signup_email_domain()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- An update that keeps the address is not a new address.
  IF TG_OP = 'UPDATE' AND NEW.email IS NOT DISTINCT FROM OLD.email THEN
    RETURN NEW;
  END IF;
  IF NEW.email IS NOT NULL AND NEW.email !~* '@phc-sa\.com$' THEN
    IF TG_OP = 'INSERT' AND EXISTS (
         SELECT 1 FROM public.supplier_account_invites i
          WHERE i.id::text = coalesce(NEW.raw_app_meta_data->>'phc_supplier_invite', '')
            AND i.email = lower(NEW.email)
            AND i.consumed_at IS NULL AND i.expires_at > now()) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Account email must be an @phc-sa.com address'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 6. Account RPCs. Pricers (Zayed) and the system administrator manage supplier accounts.
CREATE OR REPLACE FUNCTION public._supplier_account_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.is_pricer(_user_id) OR public.has_role(_user_id, 'system_admin'::public.app_role), false);
$$;
REVOKE ALL ON FUNCTION public._supplier_account_manager(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.supplier_account_prepare(_vendor_id uuid, _email text, _full_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid := auth.uid(); e text := lower(btrim(coalesce(_email, ''))); n text := btrim(coalesce(_full_name, ''));
        invite_id uuid;
BEGIN
  IF NOT public._supplier_account_manager(u) THEN
    RAISE EXCEPTION 'Only estimation, finance or the system administrator create supplier accounts. | حسابات الموردين ينشئها التقدير أو المالية أو مدير النظام.'
      USING ERRCODE = '42501';
  END IF;
  IF char_length(e) > 254 OR e !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter the supplier''s email address. | أدخل بريد المورد.' USING ERRCODE = '23514';
  END IF;
  IF e ~* '@phc-sa\.com$' THEN
    RAISE EXCEPTION 'A PHC address cannot be a supplier account. | لا يكون بريد PHC حساب مورد.' USING ERRCODE = '23514';
  END IF;
  IF char_length(n) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Enter the contact''s name (up to 200 characters). | أدخل اسم جهة الاتصال (حتى 200 حرف).' USING ERRCODE = '23514';
  END IF;
  IF _vendor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.vendors WHERE id = _vendor_id) THEN
    RAISE EXCEPTION 'Unknown supplier. | المورد غير موجود.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = e) THEN
    RAISE EXCEPTION 'An account with this email already exists. | يوجد حساب بهذا البريد.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.supplier_account_invites (vendor_id, email, full_name, created_by)
  VALUES (_vendor_id, e, n, u) RETURNING id INTO invite_id;
  RETURN invite_id;
END $$;
REVOKE ALL ON FUNCTION public.supplier_account_prepare(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_account_prepare(uuid, text, text) TO authenticated;

-- Service role only: called by sales-os-api right after it created the sign-in account.
CREATE OR REPLACE FUNCTION public.supplier_account_activate(_invite_id uuid, _user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.supplier_account_invites; mail text; touched integer;
BEGIN
  SELECT * INTO i FROM public.supplier_account_invites WHERE id = _invite_id FOR UPDATE;
  IF NOT FOUND OR i.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This supplier account request was already used or does not exist. | طلب حساب المورد مستخدم أو غير موجود.' USING ERRCODE = 'P0001';
  END IF;
  SELECT lower(email) INTO mail FROM auth.users WHERE id = _user_id;
  IF mail IS DISTINCT FROM i.email THEN
    RAISE EXCEPTION 'The account does not match the request. | الحساب لا يطابق الطلب.' USING ERRCODE = '23514';
  END IF;
  PERFORM set_config('phc.supplier_account_link', _user_id::text, true);
  -- A supplier holds no sales code: the deal-code namespace is the reps'.
  UPDATE public.profiles
     SET vendor_id = i.vendor_id, status = 'active', full_name = i.full_name, sales_code = NULL
   WHERE id = _user_id;
  GET DIAGNOSTICS touched = ROW_COUNT;
  PERFORM set_config('phc.supplier_account_link', '', true);
  IF touched = 0 THEN
    RAISE EXCEPTION 'The new account has no profile. | لا يوجد ملف للحساب الجديد.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'supplier');
  UPDATE public.supplier_account_invites SET user_id = _user_id, consumed_at = now() WHERE id = i.id;
  INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, after_value)
  VALUES (i.created_by, 'user', 'supplier_account.created', 'user', _user_id,
          jsonb_build_object('vendor_id', i.vendor_id, 'invite_id', i.id));
  RETURN jsonb_build_object('user_id', _user_id, 'vendor_id', i.vendor_id);
END $$;
REVOKE ALL ON FUNCTION public.supplier_account_activate(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supplier_account_activate(uuid, uuid) TO service_role;

-- The address a new set-password link goes to (sales-os-api, as the caller).
CREATE OR REPLACE FUNCTION public.supplier_account_email(_user_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE e text;
BEGIN
  IF NOT public._supplier_account_manager(auth.uid()) THEN
    RAISE EXCEPTION 'Only estimation, finance or the system administrator manage supplier accounts. | حسابات الموردين يديرها التقدير أو المالية أو مدير النظام.'
      USING ERRCODE = '42501';
  END IF;
  SELECT p.email INTO e FROM public.profiles p
   WHERE p.id = _user_id AND p.status = 'active' AND public.is_supplier_account(p.id);
  IF e IS NULL THEN
    RAISE EXCEPTION 'Not an active supplier account. | ليس حساب مورد نشطاً.' USING ERRCODE = '23514';
  END IF;
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.supplier_account_email(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_account_email(uuid) TO authenticated;

-- The vendor's portal accounts, for the Supplier tab.
CREATE OR REPLACE FUNCTION public.pricing_supplier_accounts(_vendor_id uuid)
RETURNS TABLE (user_id uuid, full_name text, email text, status public.user_status, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  IF NOT (public._supplier_account_manager(auth.uid()) OR public.can_read_commercial_cost(auth.uid())) THEN
    RAISE EXCEPTION 'Not allowed. | غير مسموح.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.email, p.status, p.created_at
      FROM public.profiles p
     WHERE p.vendor_id = _vendor_id AND public.is_supplier_account(p.id)
     ORDER BY p.created_at;
END $$;
REVOKE ALL ON FUNCTION public.pricing_supplier_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pricing_supplier_accounts(uuid) TO authenticated;

-- 7. What any signed-in account could read without a check on the caller.
-- Two owner-run views read every row (vendor names; automation errors). As
-- invoker they follow vendors' and automation_runs' own policies, which is who
-- reads them today (no screen does).
ALTER VIEW public.vendor_duplicate_candidates SET (security_invoker = true);
ALTER VIEW public.automation_health SET (security_invoker = true);

-- The margin floor is commercial; a supplier gets NULL. Same body as Phase 8 plus one line.
CREATE OR REPLACE FUNCTION public.current_margin_floor()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.min_margin_pct FROM public.margin_policies p
   WHERE now() >= p.effective_from
     AND (p.effective_to IS NULL OR now() < p.effective_to)
     AND NOT public.is_supplier_account(auth.uid())
   ORDER BY p.effective_from DESC LIMIT 1;
$$;

-- The session boundary on every public table that does not have it yet
-- (tables made after 20260928100000, PR 1's pricing tables, and the table
-- above). Defence in depth: their own policies already go through the role
-- predicates. Later PR 3 migrations add it to their tables themselves.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
              AND c.relname NOT IN ('profiles','user_roles')
              AND NOT EXISTS (SELECT 1 FROM pg_policies p
                               WHERE p.schemaname = 'public' AND p.tablename = c.relname
                                 AND p.policyname = 'audit_session_boundary') LOOP
    EXECUTE format('CREATE POLICY audit_session_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
                   'USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())))',
                   t.relname);
  END LOOP;
END $$;
