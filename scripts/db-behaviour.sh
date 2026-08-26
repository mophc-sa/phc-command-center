#!/usr/bin/env bash
# =============================================================================
# Replay every migration into a throwaway Postgres, then run the behavioural
# suites in tests/db-behaviour/.
#
# WHY THIS EXISTS
# Static reading of a migration cannot tell you whether a trigger fires, whether
# RLS actually isolates one user from another, or whether a rule crashes at
# runtime. The Phase 4 work found two bugs this way that source inspection had
# missed for a fortnight: an enum value a rule referenced but no migration ever
# added, and a CASE expression returning text where the column wanted an enum.
# Both only appear when the SQL runs.
#
# This never touches a remote project. It builds a local container, replays the
# migrations into it, runs the suites, and (unless KEEP=1) removes it.
#
#   bun run test:db:behaviour        # run and clean up
#   KEEP=1 bun run test:db:behaviour # leave the container up to poke at
# =============================================================================
set -uo pipefail

C=phc-db-behaviour
PORT=${PORT:-55443}
IMAGE=pgvector/pgvector:pg15     # pgvector: the RAG migration needs it
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cleanup() { [ "${KEEP:-0}" = "1" ] || docker rm -f "$C" >/dev/null 2>&1; }
trap cleanup EXIT

if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker is not running — start it and retry." >&2
  exit 1
fi

echo "▸ starting throwaway Postgres…"
docker rm -f "$C" >/dev/null 2>&1
docker run -d --name "$C" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=phc \
  -p "${PORT}:5432" "$IMAGE" >/dev/null

for _ in $(seq 1 60); do
  docker exec "$C" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

psql_() { docker exec -i "$C" psql -U postgres "$@"; }

# Roles and schemas Supabase provides that a bare Postgres does not.
psql_ -q \
  -c "CREATE ROLE authenticated;" -c "CREATE ROLE service_role;" \
  -c "CREATE ROLE anon;" -c "CREATE ROLE supabase_auth_admin;" \
  -c "CREATE ROLE rls_tester;" >/dev/null 2>&1

# rls_tester must BE authenticated, not merely resemble it. PostgREST runs every
# signed-in request as the `authenticated` role, and most policies in this schema
# are scoped `TO authenticated` — a tester outside that role matches no policy at
# all and sees zero rows. An isolation check then passes for the wrong reason,
# and would keep passing if the policy were deleted outright. Found while
# measuring query plans: `opportunities` returned nothing to its own owner.
psql_ -q -c "GRANT authenticated TO rls_tester;" >/dev/null 2>&1

psql_ -d phc -q >/dev/null 2>&1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Mirrors the auth.users columns the pgTAP suites insert. A thinner stub made
-- rls_role_matrix.test.sql abort on instance_id before a single assertion ran,
-- which from the outside reads identically to "nothing failed".
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text,
  instance_id uuid, aud text, role text, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data  jsonb DEFAULT '{}'::jsonb,
  encrypted_password text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());

-- Settable per session, so a test can act as different users and as the
-- service role (empty = auth.uid() IS NULL, which is how cron and the Edge
-- Function reach the database).
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT COALESCE(
       NULLIF(current_setting('test.uid', true), '')::uuid,
       NULLIF(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
     ) $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;

CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid, metadata jsonb,
  -- Real storage.objects has these; the Phase 6 backfill reads created_at to
  -- date a registry row, and a stub without it fails at replay rather than in
  -- a test, which is a confusing way to find out.
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
-- Real Supabase ships storage.objects with RLS ON. Without this the stub makes
-- every storage policy inert, and a policy test would pass vacuously.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, secret text, created_at timestamptz DEFAULT now());
CREATE TABLE vault.decrypted_secrets (id uuid, name text, decrypted_secret text);
SQL

echo "▸ replaying migrations…"
APPLIED=0
# Real Supabase ships ALTER DEFAULT PRIVILEGES granting new public tables to
# anon/authenticated/service_role. Without it, a table a migration creates with
# no explicit GRANT is unreachable here but reachable in production — so a
# policy test either fails spuriously or passes because the role saw nothing.
psql_ -d phc -q >/dev/null 2>&1 <<'SQL'
-- anon is included because real Supabase grants it too — that is precisely the
-- exposure migration 20260908100000 exists to remove, and a harness that never
-- grants it could not tell whether the revoke works or the grant was simply
-- never there. Leaving it out briefly also made security_baseline fail on a
-- problem the stub had invented rather than found.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQL

for f in supabase/migrations/*.sql; do
  # --single-transaction mirrors how the Supabase CLI applies each file, so a
  # statement that is illegal inside a transaction fails here too.
  if psql_ -d phc -q -v ON_ERROR_STOP=1 --single-transaction < "$f" >/tmp/dbb.err 2>&1; then
    APPLIED=$((APPLIED + 1))
  else
    echo "✗ migration failed: $(basename "$f")"
    grep -E "^(ERROR|DETAIL|HINT|LINE|CONTEXT)" /tmp/dbb.err | head -6 | sed 's/^/    /'
    exit 1
  fi
done
TOTAL=$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')
echo "  ✅ $APPLIED / $TOTAL migrations applied"

# The RLS suite runs as a non-superuser; without these grants it cannot reach
# the tables at all and every check would pass vacuously.
psql_ -d phc -q >/dev/null 2>&1 <<'SQL'
GRANT USAGE ON SCHEMA public, auth TO rls_tester;
-- Deliberately NOT a blanket grant to rls_tester. PostgREST holds table and
-- COLUMN privileges only through the `authenticated` role, which rls_tester is
-- a member of, so granting it separately would paper over exactly the thing a
-- column-privilege test needs to see: it made a revoked `unit_rate` selectable
-- again and two isolation checks passed for the wrong reason.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM rls_tester;
GRANT SELECT ON auth.users TO rls_tester;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO rls_tester;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO rls_tester;
SQL

PASS=0; FAIL=0; FAILED_SUITES=""

run_suite() {
  local file="$1" fresh="$2"
  echo ""
  echo "▸ $(basename "$file")"
  if [ "$fresh" = "fresh" ]; then
    psql_ -q -c "DROP DATABASE IF EXISTS phc WITH (FORCE);" >/dev/null 2>&1
    echo "  (needs a clean database — skipped in this pass)"
    return
  fi
  local out
  out=$(psql_ -d phc -q < "$file" 2>&1)
  echo "$out" | grep -E "PASS|FAIL" | sed 's/^NOTICE:  //; s/^ *//; s/^/  /'
  local p f
  p=$(echo "$out" | grep -c "PASS") ; f=$(echo "$out" | grep -c "FAIL")
  PASS=$((PASS + p)); FAIL=$((FAIL + f))
  if echo "$out" | grep -q "^ERROR\|^psql.*ERROR"; then
    echo "$out" | grep -E "^ERROR|^psql.*ERROR" | head -3 | sed 's/^/  /'
    # Count the error itself as a failure. A suite that aborts emits no
    # PASS/FAIL lines at all, so without this the totals stay clean and a
    # completely broken suite reports green.
    FAIL=$((FAIL + 1))
    FAILED_SUITES="$FAILED_SUITES $(basename "$file")"
  fi
  # Likewise a suite that produced no checks at all ran nothing useful.
  if [ "$p" -eq 0 ] && [ "$f" -eq 0 ]; then
    echo "  ✗ produced no checks — treating as a failure"
    FAIL=$((FAIL + 1))
    FAILED_SUITES="$FAILED_SUITES $(basename "$file")"
  fi
  [ "$f" -gt 0 ] && FAILED_SUITES="$FAILED_SUITES $(basename "$file")"
  return 0
}

# Order matters: the RLS suite reads rows the notifications suite created.
run_suite tests/db-behaviour/phase4_notifications.sql run
run_suite tests/db-behaviour/phase4_notifications_rls.sql run

# The overdue suite needs its own fixtures and a database without the rows the
# suites above inserted, so give it a fresh replay.
echo ""
echo "▸ re-replaying for the overdue suite…"
psql_ -q -c "DROP DATABASE IF EXISTS phc WITH (FORCE);" -c "CREATE DATABASE phc;" >/dev/null 2>&1
psql_ -d phc -q >/dev/null 2>&1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text,
  instance_id uuid, aud text, role text, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  encrypted_password text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT COALESCE(
       NULLIF(current_setting('test.uid', true), '')::uuid,
       NULLIF(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
     ) $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid, metadata jsonb,
  -- Real storage.objects has these; the Phase 6 backfill reads created_at to
  -- date a registry row, and a stub without it fails at replay rather than in
  -- a test, which is a confusing way to find out.
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
-- Real Supabase ships storage.objects with RLS ON. Without this the stub makes
-- every storage policy inert, and a policy test would pass vacuously.
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, secret text, created_at timestamptz DEFAULT now());
CREATE TABLE vault.decrypted_secrets (id uuid, name text, decrypted_secret text);
SQL
# Real Supabase ships ALTER DEFAULT PRIVILEGES granting new public tables to
# anon/authenticated/service_role. Without it, a table a migration creates with
# no explicit GRANT is unreachable here but reachable in production — so a
# policy test either fails spuriously or passes because the role saw nothing.
psql_ -d phc -q >/dev/null 2>&1 <<'SQL'
-- anon is included because real Supabase grants it too — that is precisely the
-- exposure migration 20260908100000 exists to remove, and a harness that never
-- grants it could not tell whether the revoke works or the grant was simply
-- never there. Leaving it out briefly also made security_baseline fail on a
-- problem the stub had invented rather than found.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQL

for f in supabase/migrations/*.sql; do
  psql_ -d phc -q -v ON_ERROR_STOP=1 --single-transaction < "$f" >/dev/null 2>&1 || {
    echo "✗ replay failed on $(basename "$f")"; exit 1; }
done
# The re-replay above created a fresh database, so the rls_tester grants from
# the first pass are gone. Any suite that runs as a non-superuser needs them
# back — without this the storage-policy checks fail on "permission denied for
# schema auth" rather than actually testing the policy.
psql_ -d phc -q >/dev/null 2>&1 <<'SQL'
GRANT USAGE ON SCHEMA public, auth, storage TO rls_tester;
-- Deliberately NOT a blanket grant to rls_tester. PostgREST holds table and
-- COLUMN privileges only through the `authenticated` role, which rls_tester is
-- a member of, so granting it separately would paper over exactly the thing a
-- column-privilege test needs to see: it made a revoked `unit_rate` selectable
-- again and two isolation checks passed for the wrong reason.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM rls_tester;
GRANT SELECT ON auth.users TO rls_tester;
GRANT SELECT ON ALL TABLES IN SCHEMA storage TO rls_tester;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO rls_tester;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO rls_tester;
SQL

run_suite tests/db-behaviour/phase4_overdue_automation.sql run
run_suite tests/db-behaviour/phase5_project_number_boq.sql run
run_suite tests/db-behaviour/phase5_won_lost_timestamps.sql run
run_suite tests/db-behaviour/attachment_read_isolation.sql run
run_suite tests/db-behaviour/attachment_backfill_policy.sql run
run_suite tests/db-behaviour/contract_security.sql run

# Phase 6 last: the lifecycle suite calls register_legacy_documents(), which
# sweeps every unregistered object in the database — including the fixtures the
# suites above created. Running it earlier would change their counts.
run_suite tests/db-behaviour/phase6_document_security.sql run
run_suite tests/db-behaviour/phase6_document_lifecycle.sql run
run_suite tests/db-behaviour/commercial_read_isolation.sql run
run_suite tests/db-behaviour/historical_sales_staging.sql run
run_suite tests/db-behaviour/phase7a_boq_revisions.sql run
run_suite tests/db-behaviour/phase7a_pricing_workflow.sql run
run_suite tests/db-behaviour/phase7b_supplier_costing.sql run
run_suite tests/db-behaviour/phase7c_quotation_revisions.sql run
run_suite tests/db-behaviour/phase7d_historical_promotion.sql run
run_suite tests/db-behaviour/hist_promotion_hardening.sql run
run_suite tests/db-behaviour/phase8_margin_integrity.sql run
run_suite tests/db-behaviour/phase9_commitments.sql run
run_suite tests/db-behaviour/activity_read_isolation.sql run
run_suite tests/db-behaviour/phase10_management_intelligence.sql run
run_suite tests/db-behaviour/phase11_ai_advisory.sql run
run_suite tests/db-behaviour/phase12_lead_discovery.sql run
run_suite tests/db-behaviour/phase13_sla_and_alerts.sql run
run_suite tests/db-behaviour/automation_engagement_parity.sql run
run_suite tests/db-behaviour/ai_context_role_isolation.sql run
run_suite tests/db-behaviour/open_table_reads.sql run
run_suite tests/db-behaviour/anon_write_surface.sql run
run_suite tests/db-behaviour/score_integrity.sql run
run_suite tests/db-behaviour/deal_attached_reads.sql run

# ─────────────────────────────────────────────────────────────────────────────
# The pgTAP security suites.
#
# WHY THESE ARE HERE NOW
# CI runs `supabase test db` over supabase/tests/*.test.sql and this script did
# not. That gap was not theoretical: a Phase 12 trigger refused the pgTAP
# fixture's own lead insert, so all 30 subtests died before running — while this
# harness reported 669/669 green. Two rounds of red CI on a pushed branch is a
# slow way to learn something a local run should have said in ninety seconds.
#
# `supabase test db` needs the whole local Supabase stack, which frequently
# collides with another project's ports on a dev machine. Installing pgTAP into
# the throwaway container and running the same files through psql gives the same
# answer without the stack.
echo ""
echo "▸ installing pgTAP for the security suites…"
if docker exec "$C" bash -c "apt-get update -qq && apt-get install -y -qq postgresql-15-pgtap" >/dev/null 2>&1; then
  # Installed into public so its functions resolve without a search_path
  # change. The baseline suite asks for it "with schema extensions", but
  # IF NOT EXISTS makes that a no-op once it is already present.
  psql_ -d phc -q -c "CREATE EXTENSION IF NOT EXISTS pgtap;" >/dev/null 2>&1

  for f in supabase/tests/*.test.sql; do
    [ -e "$f" ] || continue
    echo ""
    echo "▸ $(basename "$f")  (pgTAP)"
    # -t -A so pgTAP's result rows come out as raw TAP ("ok 1 - ...") at
    # column 0. Without them psql renders a bordered table and every
    # "^not ok" grep silently matches nothing, which reads as a clean run.
    out=$(psql_ -d phc -q -t -A -v ON_ERROR_STOP=0 < "$f" 2>&1)

    # pgTAP reports failures as lines beginning "not ok". A suite that aborts
    # early emits none at all, so an empty result is treated as a failure the
    # same way the behavioural suites are.
    nok=$(echo "$out" | grep -c "^not ok" || true)
    ok=$(echo "$out"  | grep -c "^ok "    || true)
    echo "$out" | grep -E "^not ok|^# +Failed test|^# +have|^# +want" | head -12 | sed 's/^/  /'

    if [ "$ok" -eq 0 ] && [ "$nok" -eq 0 ]; then
      echo "  ✗ produced no assertions — treating as a failure"
      echo "$out" | grep -E "^ERROR|^psql.*ERROR" | head -3 | sed 's/^/    /'
      FAIL=$((FAIL + 1)); FAILED_SUITES="$FAILED_SUITES $(basename "$f")"
    else
      echo "  $ok passed, $nok failed"
      PASS=$((PASS + ok)); FAIL=$((FAIL + nok))
      [ "$nok" -gt 0 ] && FAILED_SUITES="$FAILED_SUITES $(basename "$f")"
    fi
  done
else
  # Loud, not silent. A skipped security suite that prints nothing is how this
  # gap survived in the first place.
  echo "  ✗ could not install pgTAP — the security suites did NOT run"
  echo "    (they still run in CI; this local pass is incomplete)"
  FAIL=$((FAIL + 1)); FAILED_SUITES="$FAILED_SUITES pgtap-unavailable"
fi

echo ""
echo "─────────────────────────────────────────"
echo "  PASS: $PASS    FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "  failing suites:$FAILED_SUITES"
  exit 1
fi
echo "  ✅ all behavioural checks passed"
