-- =============================================================================
-- A sales code for every account, assigned when the account is created.
--
-- Asked for on 2026-09-06: "generated automatically on account creation, and
-- shown on the records."
--
-- THE RULE IS READ FROM THE FOUR CODES THAT ALREADY EXIST, NOT INVENTED
--
--     Ahmed Zayed         AH
--     Faisal Abdulkadhar  FA
--     Marie Falome        MA
--     Mohammed            MO
--
-- Every one is the first two letters of the FIRST name -- not the initials of
-- first and last, which is the rule a reasonable person would guess and which
-- would have produced AZ, FA, MF, M. Guessing it would have renamed three of
-- the four people who already hold a code, and a code that changes is not an
-- identifier.
--
-- COLLISIONS ARE LETTERS, BECAUSE THE COLUMN SAYS SO
--
-- The first draft of this file handed the second Mohammed "MO2" and was
-- rejected by a constraint written long before it:
--
--     profiles_sales_code_format  CHECK (sales_code ~ '^[A-Z]{2,3}$')
--
-- Two or three capital letters, no digits. So a collision grows a letter
-- instead: MO is taken, the next Mohammed Ali is MOA -- first two of the given
-- name plus the initial of the next word, which is the form a person would
-- have picked by hand. Failing that, the first three letters of the given
-- name (MOH), and failing that MOA..MOZ in order.
--
-- Twenty-eight forms per pair of initials is not a limit anyone reaches; if it
-- were, the answer would not be a longer code.
--
-- The whole assignment runs under one transaction-scoped advisory lock, so two
-- accounts created in the same second cannot both read "MO is free". The
-- UNIQUE index behind it would turn that race into a failed signup; the lock
-- means it never happens.
--
-- NAMES THIS CANNOT SPELL
--
-- `full_name` is free text and may hold no Latin letters at all. The fallback
-- chain is the email local part, then 'XX' -- never empty and never NULL,
-- because the column exists to identify a person on a record.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.next_sales_code(_name TEXT, _email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  words   TEXT[];
  base    TEXT;
  third   TEXT;
  cand    TEXT;
  letter  TEXT;
BEGIN
  -- Latin letters only: the code is typed, spoken, and read off a screen.
  words := regexp_split_to_array(
             regexp_replace(coalesce(_name, ''), '[^A-Za-z ]', '', 'g'), '\s+');
  base := upper(substring(coalesce(words[1], '') from 1 for 2));

  IF length(base) < 2 THEN
    base := upper(substring(
      regexp_replace(split_part(coalesce(_email, ''), '@', 1), '[^A-Za-z]', '', 'g') from 1 for 2));
  END IF;
  IF length(base) < 2 THEN
    base := 'XX';
  END IF;

  -- One writer at a time, so "is MO free?" cannot be answered twice.
  PERFORM pg_advisory_xact_lock(hashtext('public.profiles.sales_code'));

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE sales_code = base) THEN
    RETURN base;
  END IF;

  -- The two forms a person would have chosen, in that order.
  third := upper(substring(coalesce(words[2], '') from 1 for 1));
  IF third <> '' THEN
    cand := base || third;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE sales_code = cand) THEN
      RETURN cand;
    END IF;
  END IF;

  third := upper(substring(coalesce(words[1], '') from 3 for 1));
  IF third <> '' THEN
    cand := base || third;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE sales_code = cand) THEN
      RETURN cand;
    END IF;
  END IF;

  FOREACH letter IN ARRAY regexp_split_to_array('ABCDEFGHIJKLMNOPQRSTUVWXYZ', '') LOOP
    cand := base || letter;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE sales_code = cand) THEN
      RETURN cand;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'Cannot allocate a sales code for % (% exhausted)', _email, base;
END;
$$;

COMMENT ON FUNCTION public.next_sales_code IS
  'The next free sales code for a person: first two Latin letters of their given name, growing a third letter on collision. Serialised by an advisory lock so two signups cannot claim the same code.';

-- ---- Backfill, before the unique index can object ---------------------------
-- Ordered by creation so the codes fall the way they would have if this had
-- existed from the start: the older account keeps the shorter code.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, full_name, email FROM public.profiles
     WHERE sales_code IS NULL ORDER BY created_at, email
  LOOP
    UPDATE public.profiles
       SET sales_code = public.next_sales_code(r.full_name, r.email)
     WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_sales_code_key
  ON public.profiles (sales_code) WHERE sales_code IS NOT NULL;

-- ---- And from now on, at creation -------------------------------------------
-- On profiles rather than on auth.users: a profile can be created by the
-- signup trigger, by an import, or by an admin, and all three need a code.
CREATE OR REPLACE FUNCTION public.assign_sales_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sales_code IS NULL THEN
    NEW.sales_code := public.next_sales_code(NEW.full_name, NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_assign_sales_code ON public.profiles;
CREATE TRIGGER profiles_assign_sales_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.assign_sales_code();

COMMENT ON COLUMN public.profiles.sales_code IS
  'Short identifier for this person on records they own or entered. Assigned automatically at account creation and never reassigned -- a code that changes is not an identifier.';
