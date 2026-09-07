-- Audit F01–F05: enforce account state and session assurance at the data boundary.
-- Bootstrap reads remain available so inactive users see their status and MFA
-- users can enroll. Service-role jobs retain their existing explicit grants.
CREATE OR REPLACE FUNCTION public.has_app_access(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id AND status = 'active')
    AND (NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = _user_id
      AND role IN ('general_manager','finance_manager','sales_manager','system_admin','managing_director')
    ) OR (auth.uid() = _user_id AND auth.jwt()->>'aal' = 'aal2'));
$$;
REVOKE ALL ON FUNCTION public.has_app_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_app_access(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=_user_id AND status='active')
    AND (auth.uid() IS DISTINCT FROM _user_id OR public.has_app_access(_user_id));
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles r JOIN public.profiles p ON p.id = r.user_id
    WHERE r.user_id = _user_id AND r.role = ANY(_roles) AND p.status = 'active')
    -- Looking up an assignee's roles is not checking that assignee's session.
    AND (auth.uid() IS DISTINCT FROM _user_id OR public.has_app_access(_user_id));
$$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_user_id, ARRAY[_role]);
$$;

DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    AND tablename NOT IN ('profiles','user_roles') LOOP
    EXECUTE format('CREATE POLICY audit_session_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())))', t.tablename);
  END LOOP;
END $$;
CREATE POLICY audit_session_boundary ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
CREATE POLICY audit_profile_reads ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()) OR (SELECT public.has_app_access(auth.uid())));
CREATE POLICY audit_role_reads ON public.user_roles AS RESTRICTIVE FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.has_app_access(auth.uid())));
CREATE POLICY audit_role_grants ON public.user_roles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_app_access(auth.uid())));
CREATE POLICY audit_role_updates ON public.user_roles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((SELECT public.has_app_access(auth.uid()))) WITH CHECK ((SELECT public.has_app_access(auth.uid())));
CREATE POLICY audit_role_revokes ON public.user_roles AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((SELECT public.has_app_access(auth.uid())));

CREATE OR REPLACE FUNCTION public.guard_profile_administration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
    NEW.id IS DISTINCT FROM OLD.id OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.email IS DISTINCT FROM OLD.email OR NEW.sales_code IS DISTINCT FROM OLD.sales_code

  ) AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Profile administrative fields require an active administrator with MFA' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_profile_administration BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_administration();

CREATE OR REPLACE FUNCTION public.guard_approval_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.decision IS NOT NULL OR NEW.decided_at IS NOT NULL
      OR NEW.execution_status <> 'not_run' OR NEW.executed_at IS NOT NULL OR NEW.executed_by IS NOT NULL THEN
      RAISE EXCEPTION 'Approval requests must start pending and unexecuted';
    END IF;
    IF auth.uid() IS NOT NULL AND NEW.requested_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Approval requester must be the caller' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF (NEW.requested_by, NEW.approval_type, NEW.requested_action, NEW.requested_payload,
        NEW.linked_record_type, NEW.linked_record_id, NEW.related_opportunity_id)
      IS DISTINCT FROM (OLD.requested_by, OLD.approval_type, OLD.requested_action, OLD.requested_payload,
        OLD.linked_record_type, OLD.linked_record_id, OLD.related_opportunity_id) THEN
      RAISE EXCEPTION 'Approval scope is immutable; submit a new request';
    END IF;

  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_approval_integrity BEFORE INSERT OR UPDATE ON public.approvals
FOR EACH ROW EXECUTE FUNCTION public.guard_approval_integrity();

CREATE OR REPLACE FUNCTION public.guard_bafo_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE step text; oldj jsonb; newj jsonb := to_jsonb(NEW); BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.commercial_review_status <> 'pending'
      OR NEW.cost_approval_status <> 'pending' OR NEW.finance_review_status <> 'pending'
      OR NEW.final_approval_status <> 'pending' OR NEW.sent_to_client_at IS NOT NULL
      OR NEW.sent_to_client_by IS NOT NULL THEN
      RAISE EXCEPTION 'BAFO requests must start pending and unsent';
    END IF;
    FOREACH step IN ARRAY ARRAY['commercial_review','cost_approval','finance_review','final_approval'] LOOP
      IF newj->>(step || '_by') IS NOT NULL OR newj->>(step || '_at') IS NOT NULL THEN
        RAISE EXCEPTION 'BAFO decision metadata cannot be supplied on insert';
      END IF;
    END LOOP;
  ELSE
    oldj := to_jsonb(OLD);
    IF (NEW.opportunity_id, NEW.quotation_id, NEW.requested_by) IS DISTINCT FROM
       (OLD.opportunity_id, OLD.quotation_id, OLD.requested_by) THEN
      RAISE EXCEPTION 'BAFO scope is immutable';
    END IF;
    IF (NEW.proposed_value, NEW.proposed_discount_pct, NEW.proposed_payment_terms, NEW.justification)
      IS DISTINCT FROM (OLD.proposed_value, OLD.proposed_discount_pct, OLD.proposed_payment_terms, OLD.justification)
      AND (OLD.commercial_review_status <> 'pending' OR OLD.cost_approval_status <> 'pending'
        OR OLD.finance_review_status <> 'pending' OR OLD.final_approval_status <> 'pending'
        OR (auth.uid() IS NOT NULL AND auth.uid() <> OLD.requested_by)) THEN
      RAISE EXCEPTION 'Reviewed BAFO terms are immutable; submit a new request';
    END IF;
    FOREACH step IN ARRAY ARRAY['commercial_review','cost_approval','finance_review','final_approval'] LOOP
      IF newj->>(step || '_status') IS DISTINCT FROM oldj->>(step || '_status') THEN
        IF oldj->>(step || '_status') <> 'pending' OR NEW.status = 'rejected' THEN
          RAISE EXCEPTION 'A BAFO decision is final; submit a new request';
        END IF;
      ELSIF (newj->>(step || '_by'), newj->>(step || '_at'), newj->>(step || '_notes')) IS DISTINCT FROM
            (oldj->>(step || '_by'), oldj->>(step || '_at'), oldj->>(step || '_notes')) THEN
        RAISE EXCEPTION 'BAFO decision metadata must accompany its decision';
      END IF;
    END LOOP;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'BAFO overall status is derived from its approval chain';
    END IF;
    IF OLD.sent_to_client_at IS NOT NULL AND (NEW.sent_to_client_at, NEW.sent_to_client_by)
      IS DISTINCT FROM (OLD.sent_to_client_at, OLD.sent_to_client_by) THEN
      RAISE EXCEPTION 'BAFO sent receipt is immutable';
    END IF;
    IF OLD.sent_to_client_at IS NULL AND NEW.sent_to_client_at IS NULL AND NEW.sent_to_client_by IS NOT NULL THEN
      RAISE EXCEPTION 'BAFO sender requires an approved send action';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- Alphabetically before the existing step trigger, which stamps decisions and derives status.
CREATE TRIGGER audit_bafo_integrity BEFORE INSERT OR UPDATE ON public.bafo_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_bafo_integrity();

REVOKE UPDATE ON public.approvals FROM authenticated;
GRANT UPDATE(status,decision,decision_notes,decided_at,assigned_approver,recommendation) ON public.approvals TO authenticated;
