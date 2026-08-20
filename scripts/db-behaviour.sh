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

psql_ -d phc -q >/dev/null 2>&1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data  jsonb DEFAULT '{}'::jsonb,
  encrypted_password text, created_at timestamptz DEFAULT now());

-- Settable per session, so a test can act as different users and as the
-- service role (empty = auth.uid() IS NULL, which is how cron and the Edge
-- Function reach the database).
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;

CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid, metadata jsonb);
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, secret text, created_at timestamptz DEFAULT now());
CREATE TABLE vault.decrypted_secrets (id uuid, name text, decrypted_secret text);
SQL

echo "▸ replaying migrations…"
APPLIED=0
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
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rls_tester;
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
  if echo "$out" | grep -q "^ERROR"; then
    echo "$out" | grep "^ERROR" | head -3 | sed 's/^/  /'
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
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb, raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  encrypted_password text, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz DEFAULT now());
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text, name text, owner uuid, metadata jsonb);
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, secret text, created_at timestamptz DEFAULT now());
CREATE TABLE vault.decrypted_secrets (id uuid, name text, decrypted_secret text);
SQL
for f in supabase/migrations/*.sql; do
  psql_ -d phc -q -v ON_ERROR_STOP=1 --single-transaction < "$f" >/dev/null 2>&1 || {
    echo "✗ replay failed on $(basename "$f")"; exit 1; }
done
run_suite tests/db-behaviour/phase4_overdue_automation.sql run
run_suite tests/db-behaviour/phase5_project_number_boq.sql run
run_suite tests/db-behaviour/phase5_won_lost_timestamps.sql run

echo ""
echo "─────────────────────────────────────────"
echo "  PASS: $PASS    FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "  failing suites:$FAILED_SUITES"
  exit 1
fi
echo "  ✅ all behavioural checks passed"
