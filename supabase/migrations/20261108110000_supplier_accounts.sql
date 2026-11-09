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
--
-- What makes an account a supplier is profiles.vendor_id, the guarded column
-- (set only by supplier_account_activate or the service role, never by a
-- client), not the supplier role row: a role row can be deleted, the link
-- cannot be dropped from a live account. The role row is kept as a second
-- marker (either one closes the boundary), and it cannot be removed while the
-- link is set. Suppliers are also nobody to staff: is_active_user and
-- has_any_role are false about them, so no task, notification or assignment
-- reaches them.
-- =============================================================================

-- 1. The vendor a supplier account prices for.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS profiles_vendor ON public.profiles (vendor_id) WHERE vendor_id IS NOT NULL;
COMMENT ON COLUMN public.profiles.vendor_id IS
  'Supplier accounts only: the vendor this account prices for, and what makes the account a supplier. Set by supplier_account_activate; only the service role clears it, and only on a suspended account.';

-- Never from a client session. supplier_account_activate sets it (transaction-
-- local flag naming the profile, inside the definer function); the service role
-- may also set or clear it. A staff account (any other role) is never linked,
-- and a link is cleared only once the account is no longer active. The lock is
-- the one user_roles_supplier_guard takes, so a link and a role grant for the
-- same account cannot race past each other.
-- Not SECURITY DEFINER on purpose: current_user is the caller's role here.
CREATE OR REPLACE FUNCTION public.profiles_vendor_link_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.vendor_id IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.vendor_id IS DISTINCT FROM OLD.vendor_id) THEN
    IF current_user IN ('authenticated', 'anon')
       OR NOT (current_user = 'service_role'
               OR coalesce(current_setting('phc.supplier_account_link', true), '') = NEW.id::text) THEN
      RAISE EXCEPTION 'A supplier account''s vendor is set when the account is created. | يُحدَّد مورد الحساب عند إنشائه.'
        USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('public.user_roles'), hashtext(NEW.id::text));
    IF NEW.vendor_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = NEW.id AND r.role <> 'supplier') THEN
      RAISE EXCEPTION 'A staff account cannot be linked to a supplier. | لا يُربط حساب موظف بمورد.' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.vendor_id IS NULL AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'Suspend the supplier account before unlinking it. | أوقف حساب المورد قبل فك ربطه.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_vendor_link_guard ON public.profiles;
CREATE TRIGGER profiles_vendor_link_guard BEFORE INSERT OR UPDATE OF vendor_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_vendor_link_guard();

-- A supplier edits nothing on its own profile but its language: its name is the
-- contact's name as PHC recorded it. (Staff keep editing their own profiles.)
CREATE OR REPLACE FUNCTION public.profiles_supplier_self_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.vendor_id IS NOT NULL AND OLD.id = auth.uid() AND current_user IN ('authenticated', 'anon')
     AND (to_jsonb(NEW) - 'language' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'language' - 'updated_at') THEN
    RAISE EXCEPTION 'A supplier account''s details are kept by PHC. | بيانات حساب المورد تحفظها PHC.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS profiles_supplier_self_guard ON public.profiles;
CREATE TRIGGER profiles_supplier_self_guard BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_supplier_self_guard();

-- 2. Who is a supplier, and which vendor the current session prices for.
-- Keyed on the guarded link; the role row is a second marker, never the only one.
CREATE OR REPLACE FUNCTION public.is_supplier_account(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND vendor_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'supplier'::public.app_role));
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

-- 3. A supplier never has app access. Same body as 20261104120000 plus the
-- supplier conditions: the vendor link (the key) and the role row (a second marker).
CREATE OR REPLACE FUNCTION public.has_app_access(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND status = 'active' AND vendor_id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'supplier')
    AND (NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id
      AND role IN ('general_manager','finance_manager','sales_manager','system_admin','managing_director')
    ) OR (auth.uid() = _user_id AND auth.jwt()->>'aal' = 'aal2')), false);
$$;
REVOKE ALL ON FUNCTION public.has_app_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_app_access(uuid) TO authenticated, service_role;

-- A supplier is nobody staff can work with, also when staff ask about it (an
-- assignee, a recipient): same bodies as 20260928100000 plus vendor_id IS NULL.
-- emit_notification and every assignment check go through these.
CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=_user_id AND status='active' AND vendor_id IS NULL)
    AND (auth.uid() IS DISTINCT FROM _user_id OR public.has_app_access(_user_id));
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _user_id AND r.role = ANY(_roles) AND p.status = 'active' AND p.vendor_id IS NULL)
    -- Looking up an assignee's roles is not checking that assignee's session.
    AND (auth.uid() IS DISTINCT FROM _user_id OR public.has_app_access(_user_id));
$$;

-- No task is owned by a supplier, whichever path writes it (create_task and
-- decide_meeting_action_item check only that the owner is active).
CREATE OR REPLACE FUNCTION public.tasks_owner_not_supplier()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL AND public.is_supplier_account(NEW.owner_id) THEN
    RAISE EXCEPTION 'A supplier account cannot hold a task. | لا تُسند مهمة إلى حساب مورد.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tasks_owner_not_supplier ON public.tasks;
CREATE TRIGGER tasks_owner_not_supplier BEFORE INSERT OR UPDATE OF owner_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_owner_not_supplier();

-- 4. The supplier role stands alone, always has its vendor, and stays while the
-- link is set. A vendor-linked profile holds no other role. To retire a supplier
-- account, suspend it (Admin settings); the service role may then unlink it.
-- Deleting the sign-in account (auth.users) removes the role with it. One
-- writer per account at a time (the lock profiles_vendor_link_guard also takes).
CREATE OR REPLACE FUNCTION public.user_roles_supplier_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.role = 'supplier'
     AND (TG_OP = 'DELETE' OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.role IS DISTINCT FROM OLD.role) THEN
    PERFORM pg_advisory_xact_lock(hashtext('public.user_roles'), hashtext(OLD.user_id::text));
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.user_id AND p.vendor_id IS NOT NULL)
       AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
      RAISE EXCEPTION 'A supplier account keeps its supplier role; suspend the account instead. | حساب المورد يحتفظ بدوره؛ أوقف الحساب بدلاً من ذلك.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('public.user_roles'), hashtext(NEW.user_id::text));
  IF NEW.role = 'supplier' THEN
    IF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = NEW.user_id AND r.role <> 'supplier') THEN
      RAISE EXCEPTION 'A supplier account holds no other role. | حساب المورد لا يحمل دوراً آخر.' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.vendor_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Supplier accounts are created from the pricing file, linked to a supplier. | حسابات الموردين تُنشأ من ملف التسعير مربوطة بمورد.'
        USING ERRCODE = '23514';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = NEW.user_id AND r.role = 'supplier')
     OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.user_id AND p.vendor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A supplier account holds no other role. | حساب المورد لا يحمل دوراً آخر.' USING ERRCODE = '23514';
  ELSIF EXISTS (
          -- Ever a supplier: an account request was activated for this user, or
          -- one names this non-PHC address. Unlinking does not make it staff.
          SELECT 1 FROM public.supplier_account_invites i
           WHERE i.user_id = NEW.user_id
              OR i.email = (SELECT lower(u.email) FROM auth.users u
                             WHERE u.id = NEW.user_id AND u.email !~* '@phc-sa\.com$')) THEN
    RAISE EXCEPTION 'A former supplier account cannot become staff. | حساب مورد سابق لا يصبح حساب موظف.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS user_roles_supplier_guard ON public.user_roles;
CREATE TRIGGER user_roles_supplier_guard BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.user_roles_supplier_guard();

-- 5. auth.users takes a non-PHC address only for a supplier account that the
-- supplier-account action (sales-os-api) is creating right now: a pricer's
-- request row (supplier_account_prepare) for that address, named in
-- app_metadata, which only the service role can set. A sign-up from the app
-- cannot set app_metadata.
--
-- GoTrue's admin createUser (observed on the local auth container, 2026-11-08)
-- INSERTs the row with app_metadata {"provider","providers"} only, then writes
-- the custom app_metadata in a later UPDATE of the same transaction. So the
-- BEFORE INSERT check admits a non-PHC address only while an open request for
-- it exists, and a deferred check at commit requires the request's id in
-- app_metadata. A public sign-up for that address in the 15-minute window
-- fails at commit.
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
  -- A supplier account keeps the address it was created with (never a PHC one).
  IF TG_OP = 'UPDATE' AND (
       EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.id AND p.vendor_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = NEW.id AND r.role = 'supplier')
       OR OLD.raw_app_meta_data ? 'phc_supplier_invite') THEN
    RAISE EXCEPTION 'A supplier account keeps its email address'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.email IS NOT NULL AND NEW.email !~* '@phc-sa\.com$' THEN
    IF TG_OP = 'INSERT' AND EXISTS (
         SELECT 1 FROM public.supplier_account_invites i
          WHERE i.email = lower(NEW.email)
            AND i.consumed_at IS NULL AND i.expires_at > now()
            AND coalesce(NEW.raw_app_meta_data->>'phc_supplier_invite', i.id::text) = i.id::text) THEN
      RETURN NEW;  -- the deferred check below decides at commit
    END IF;
    RAISE EXCEPTION 'Account email must be an @phc-sa.com address'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- At commit: a non-PHC account must carry, in app_metadata, the id of an open
-- request for its address (or the request activated for it in this transaction).
CREATE OR REPLACE FUNCTION public.enforce_supplier_account_invite()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE meta jsonb; mail text;
BEGIN
  SELECT u.raw_app_meta_data, u.email INTO meta, mail FROM auth.users u WHERE u.id = NEW.id;
  IF NOT FOUND OR mail IS NULL OR mail ~* '@phc-sa\.com$' THEN
    RETURN NULL;  -- gone again, or no longer a non-PHC address (the email trigger rules on changes)
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.supplier_account_invites i
        WHERE i.id::text = coalesce(meta->>'phc_supplier_invite', '')
          AND i.email = lower(mail)
          AND i.expires_at > now()
          AND (i.consumed_at IS NULL OR i.user_id = NEW.id)) THEN
    RAISE EXCEPTION 'Account email must be an @phc-sa.com address'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_supplier_account_invite() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS phc_supplier_invite_check ON auth.users;
CREATE CONSTRAINT TRIGGER phc_supplier_invite_check AFTER INSERT ON auth.users
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.email IS NOT NULL AND NEW.email !~* '@phc-sa\.com$')
  EXECUTE FUNCTION public.enforce_supplier_account_invite();

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

-- Whether an account has a verified second factor (sales-os-api, service role only):
-- a set-password link for such an account would let whoever holds it take over the
-- login with its password, so a pricer may not issue one; the administrator may.
CREATE OR REPLACE FUNCTION public._supplier_account_has_verified_mfa(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = _user_id AND f.status = 'verified');
$$;
REVOKE ALL ON FUNCTION public._supplier_account_has_verified_mfa(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._supplier_account_has_verified_mfa(uuid) TO service_role;

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
-- Phase 8 never revoked it, so anon could read it. Signed-in callers keep it:
-- pricing_selling_totals and the floor guard call it with the caller's rights.
CREATE OR REPLACE FUNCTION public.current_margin_floor()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.min_margin_pct FROM public.margin_policies p
   WHERE now() >= p.effective_from
     AND (p.effective_to IS NULL OR now() < p.effective_to)
     AND NOT public.is_supplier_account(auth.uid())
   ORDER BY p.effective_from DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_margin_floor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_margin_floor() TO authenticated, service_role;

-- The cost basis of any estimation, by id: anon could call it, and so could any
-- signed-in account. Same body as Phase 8 plus the caller check. It stays
-- granted to authenticated because estimation_cost_reconciliation calls it with
-- the caller's rights (that view already shows only cost readers). The margin
-- trigger (internal_price_compute_margin) still gets the figure for a caller who
-- cannot read cost, as Phase 8 intends: it runs inside a trigger.
CREATE OR REPLACE FUNCTION public.estimation_cost_basis(_estimation_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _e         RECORD;
  _supplier  NUMERIC;
  _material  NUMERIC;
  _subtotal  NUMERIC;
BEGIN
  IF auth.uid() IS NOT NULL AND pg_trigger_depth() = 0
     AND NOT coalesce(public.can_read_commercial_cost(auth.uid()), false) THEN
    RETURN NULL;
  END IF;

  SELECT e.cost_total, e.wastage_pct, e.installation_cost, e.overhead_pct, e.boq_revision_id
    INTO _e
    FROM public.estimations e WHERE e.id = _estimation_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- What the selected suppliers actually cost, if any have been chosen.
  SELECT sum(l.line_cost)
    INTO _supplier
    FROM public.supplier_quote_lines l
    JOIN public.supplier_quotes q ON q.id = l.supplier_quote_id
   WHERE l.is_selected
     AND q.boq_revision_id = _e.boq_revision_id;

  _material := coalesce(_supplier, _e.cost_total, 0);
  _subtotal := _material
             + (_material * coalesce(_e.wastage_pct, 0) / 100)
             + coalesce(_e.installation_cost, 0);

  RETURN round(_subtotal + (_subtotal * coalesce(_e.overhead_pct, 0) / 100), 2);
END; $$;
REVOKE ALL ON FUNCTION public.estimation_cost_basis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.estimation_cost_basis(uuid) TO authenticated, service_role;

-- Three RPCs answered from auth.uid() alone. Same bodies as 20261006100000 and
-- 20261028100000 plus has_app_access on the caller: a supplier (or a session
-- without its required MFA) gets nothing.
CREATE OR REPLACE FUNCTION public.my_day(_day date)
RETURNS TABLE (kind text, id uuid, title text, due_date date, done boolean, overdue boolean,
               bucket text, opportunity_id uuid, opportunity_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.kind, i.id, i.title, i.due_date, i.done, i.overdue AND NOT i.done, i.bucket,
         i.opportunity_id, o.project_name
    FROM public.day_items((SELECT auth.uid()), _day) i
    LEFT JOIN public.opportunities o ON o.id = i.opportunity_id
   WHERE public.has_app_access((SELECT auth.uid()))
   ORDER BY i.done, i.overdue DESC, i.due_date, i.title;
$$;

CREATE OR REPLACE FUNCTION public.meeting_review_queue()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.has_app_access(auth.uid()) THEN public.meeting_review_queue_for(auth.uid()) END;
$$;

CREATE OR REPLACE FUNCTION public.my_fireflies_connection()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('email', fireflies_email, 'status', status, 'connected_at', connected_at,
                            'last_synced_at', last_synced_at, 'last_error', last_error)
    FROM public.fireflies_connections WHERE user_id = auth.uid() AND public.has_app_access(auth.uid());
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
