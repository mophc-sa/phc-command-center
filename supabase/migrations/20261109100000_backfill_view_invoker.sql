-- =============================================================================
-- document_backfill_status read past row security (found 2026-11-09).
--
-- The view (20260823110000) runs as its owner, so it reads
-- document_backfill_report without that table's "document handlers" policy.
-- In production it is also granted to anon and authenticated (hosted default
-- privileges; the local stack has no such grant), so anyone with the public
-- key could read the unresolved document references: record ids, raw values
-- and storage paths. Run it as the caller and take it away from anon. The
-- other two owner-run views the supplier preflight found are already
-- security_invoker since 20261108110000; anon loses them too.
-- =============================================================================
ALTER VIEW public.document_backfill_status SET (security_invoker = true);

REVOKE ALL ON public.document_backfill_status FROM anon;
REVOKE ALL ON public.automation_health FROM anon;
REVOKE ALL ON public.vendor_duplicate_candidates FROM anon;
