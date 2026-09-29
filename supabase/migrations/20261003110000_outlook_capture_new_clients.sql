-- =============================================================================
-- New clients are not missed by Outlook capture.
--
-- Capture keeps only mail with a known client, and reads each message once.
-- So mail from a client who is added to the system AFTER their email arrived
-- was passed over for good. Two fixes, user-approved 2026-09-29:
--
--   1. A contact saved with a company email fills that company's
--      website_domain when it has none — so every employee of the company is
--      recognised, not only the one person. Never a free-mail or our own
--      domain, and never a domain another company already holds.
--
--   2. A new client (a contact email, or a company domain, set or changed)
--      restarts every mailbox's sync round. outlook-sync then re-reads the last
--      30 days; mail already stored is skipped by its message id, so nothing is
--      duplicated and the missed mail is picked up.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_free_mail_domain(_domain text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  -- Keep in step with FREE_MAIL_DOMAINS in supabase/functions/_shared/mail-capture.ts
  -- (a contract test compares the two lists).
  SELECT lower(coalesce(_domain, '')) = ANY (ARRAY[
    'gmail.com','googlemail.com','hotmail.com','hotmail.co.uk','outlook.com','outlook.sa','live.com',
    'msn.com','yahoo.com','yahoo.co.uk','ymail.com','icloud.com','me.com','mac.com','aol.com',
    'proton.me','protonmail.com','gmx.com','zoho.com','mail.com','yandex.com']);
$$;

-- ============ 1. A contact's email teaches the company its domain ============
CREATE OR REPLACE FUNCTION public.contact_fills_company_domain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE dom text;
BEGIN
  IF NEW.company_id IS NULL OR NEW.email IS NULL OR NEW.archived_at IS NOT NULL THEN RETURN NEW; END IF;
  dom := lower(split_part(btrim(NEW.email), '@', 2));
  IF dom = '' OR dom !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' OR public.is_free_mail_domain(dom)
     OR dom = 'phc-sa.com' OR dom LIKE '%.phc-sa.com' THEN RETURN NEW; END IF;
  -- A domain another company already holds stays with that company: two records
  -- claiming it would make every one of its emails ambiguous.
  IF EXISTS (SELECT 1 FROM public.companies WHERE website_domain = dom AND archived_at IS NULL) THEN RETURN NEW; END IF;

  UPDATE public.companies SET website_domain = dom
   WHERE id = NEW.company_id AND website_domain IS NULL AND archived_at IS NULL;
  IF FOUND THEN
    INSERT INTO public.audit_log(actor_id, actor_type, action, entity_type, entity_id, after_value)
    VALUES (auth.uid(), 'system', 'company.website_domain_derived', 'company', NEW.company_id,
            jsonb_build_object('website_domain', dom, 'source', 'contact email', 'contact_id', NEW.id));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contact_fills_company_domain ON public.contacts;
CREATE TRIGGER trg_contact_fills_company_domain
  AFTER INSERT OR UPDATE OF email, company_id ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contact_fills_company_domain();

-- ============ 2. A new client restarts the mailbox sync rounds ============
CREATE OR REPLACE FUNCTION public.new_client_rescans_mail()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'contacts' THEN
    IF NEW.email IS NULL OR (TG_OP = 'UPDATE' AND lower(NEW.email) IS NOT DISTINCT FROM lower(OLD.email)) THEN RETURN NEW; END IF;
  ELSE
    IF NEW.website_domain IS NULL OR (TG_OP = 'UPDATE' AND NEW.website_domain IS NOT DISTINCT FROM OLD.website_domain) THEN RETURN NEW; END IF;
  END IF;
  UPDATE public.mail_sync_state SET delta_link = NULL WHERE delta_link IS NOT NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contact_rescans_mail ON public.contacts;
CREATE TRIGGER trg_contact_rescans_mail
  AFTER INSERT OR UPDATE OF email ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.new_client_rescans_mail();

DROP TRIGGER IF EXISTS trg_company_domain_rescans_mail ON public.companies;
CREATE TRIGGER trg_company_domain_rescans_mail
  AFTER INSERT OR UPDATE OF website_domain ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.new_client_rescans_mail();

REVOKE ALL ON FUNCTION public.contact_fills_company_domain() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.new_client_rescans_mail() FROM PUBLIC, anon, authenticated;
