-- =============================================================================
-- Overdue notifications name what they are about.
--
-- Reported 2026-10-19: "clicking the notification does not open the project
-- page." notify_overdue_items wrote entity_type 'opportunity' for every flag,
-- but a flag can be linked to an RFQ, a tender, a quotation or an approval
-- (run_sales_automations rules 5, 12 and the approval/quotation rules). The
-- click then opened /opportunities/<rfq id>, which is not found.
--
-- 1. The notifier passes the flag's own linked_record_type through, plus the
--    deal when the flag already knows it, so the click can open the deal.
-- 2. Notifications already delivered with the wrong type are corrected from
--    the flag named in their dedupe key ('overdue:<flag id>:<due date>').
-- =============================================================================

CREATE OR REPLACE FUNCTION public.notify_overdue_items()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _r          RECORD;
  _count      INTEGER := 0;
  _lookback   INTEGER := 7;
BEGIN
  FOR _r IN
    SELECT f.id, f.action_owner_id AS owner_id, f.due_date, f.reason,
           f.linked_record_id, f.priority,
           CASE WHEN f.linked_record_type IN ('opportunity','rfq','tender','approval','quotation','inbox_item','task')
                THEN f.linked_record_type ELSE 'opportunity' END AS entity_type
      FROM public.opportunity_flags f
     WHERE f.due_date < CURRENT_DATE
       AND f.due_date >= CURRENT_DATE - _lookback
       AND f.status IN ('open','in_progress','escalated','blocked')
       AND f.action_owner_id IS NOT NULL
       -- Only tier A/B become notifications; C would be noise.
       AND f.priority IN ('A','B')
  LOOP
    -- emit_notification enforces the rest: no self-notification, no suspended
    -- recipients, and no duplicate for the same (recipient, type, entity, key).
    IF public.emit_notification(
         _r.owner_id, 'item_overdue', _r.entity_type, _r.linked_record_id,
         COALESCE(_r.reason, 'Action overdue'),
         'This action passed its due date on ' || _r.due_date::TEXT || '.',
         'critical', 'item_became_overdue',
         'overdue:' || _r.id::TEXT || ':' || _r.due_date::TEXT,
         CASE WHEN _r.entity_type = 'opportunity'
              THEN jsonb_build_object('opportunity_id', _r.linked_record_id)
              ELSE NULL END
       ) IS NOT NULL
    THEN
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notify_overdue_items() FROM PUBLIC;

COMMENT ON FUNCTION public.notify_overdue_items IS
  'Emits item_overdue notifications for tier A/B flags that lapsed within the last 7 days, typed by the flag''s linked_record_type. Called from run_sales_automations. Idempotent: the dedupe key is (flag id, due date).';

-- Correct the ones already delivered. Only rows whose flag points at something
-- other than an opportunity change; the dedupe key stays as it was.
UPDATE public.notifications n
   SET entity_type = f.linked_record_type
  FROM public.opportunity_flags f
 WHERE n.notification_type = 'item_overdue'
   AND n.entity_type = 'opportunity'
   AND n.dedupe_key LIKE 'overdue:' || f.id::TEXT || ':%'
   AND f.linked_record_type IN ('rfq','tender','approval','quotation','inbox_item','task');
