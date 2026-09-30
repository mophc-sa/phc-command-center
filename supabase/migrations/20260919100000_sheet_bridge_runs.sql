-- =============================================================================
-- Transition bridge run log.
--
-- The bridge reads the SharePoint quotation sheet and reports how it differs
-- from this system. It never writes to opportunities -- a bridge that wrote
-- would overwrite a salesperson's work on its first run and teach the team the
-- app does not hold, which is the opposite of what the transition is for. This
-- table is the only thing it writes.
--
-- Why keep a log at all: the point of the bridge is to end. `adoption` -- work
-- that exists only in the system, as a share of everything -- is the number
-- that says when. Without a history there is no way to see it rising, and a
-- temporary bridge nobody measures becomes a permanent second source of truth.
--
-- Nobody may write this from a browser. The bridge runs as service_role; the
-- app only reads. Runs are evidence of what the sheet said on a given day, and
-- evidence that can be edited by its readers is not evidence.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sheet_bridge_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Null on a failed run: a run that never read the sheet has no counts, and
  -- storing zeros would make a failure indistinguishable from an empty sheet.
  sheet_rows      INT,
  sheet_only      INT,
  changed         INT,
  unchanged       INT,
  system_only     INT,
  adoption        NUMERIC(5,4),

  -- Row numbers are the join key, so inserting a row in the sheet renumbers
  -- everything below it. This flag says the diff is probably an artefact of
  -- that rather than hundreds of real edits.
  shift_suspected BOOLEAN NOT NULL DEFAULT false,

  -- Unchanged rows are excluded and the list is capped: this is a working
  -- queue, not an archive of the spreadsheet.
  findings        JSONB,
  error           TEXT,

  CONSTRAINT sheet_bridge_runs_adoption_range
    CHECK (adoption IS NULL OR (adoption >= 0 AND adoption <= 1)),
  -- A run either read the sheet or failed. Both at once means the writer is
  -- confused, and a half-recorded run would be read as a real measurement.
  CONSTRAINT sheet_bridge_runs_outcome
    CHECK ((error IS NULL) <> (sheet_rows IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_sheet_bridge_runs_started
  ON public.sheet_bridge_runs (started_at DESC);

COMMENT ON TABLE public.sheet_bridge_runs IS
  'One row per transition-bridge run against the SharePoint quotation sheet. Read-only from the app: the bridge writes with service_role. `adoption` is the signal for switching the bridge off.';
COMMENT ON COLUMN public.sheet_bridge_runs.adoption IS
  'Opportunities created in the system, as a share of all opportunities. Rises as the team stops working in the spreadsheet.';
COMMENT ON COLUMN public.sheet_bridge_runs.shift_suspected IS
  'True when most matched rows differ, which usually means sheet rows were inserted or deleted rather than that the team edited everything.';

ALTER TABLE public.sheet_bridge_runs ENABLE ROW LEVEL SECURITY;

-- Read: the roles that would act on a finding. Not viewer, not salesperson --
-- a drift report names deals across the whole pipeline.
CREATE POLICY "Bridge runs readable by managers" ON public.sheet_bridge_runs
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(
      auth.uid(),
      ARRAY['system_admin','managing_director','general_manager','sales_manager','bd_manager','sales_ops']::public.app_role[]
    )
  );

-- No INSERT, UPDATE or DELETE policy, and no write grant: the bridge writes
-- with service_role, which bypasses RLS. Deliberate -- see the header.
GRANT SELECT ON public.sheet_bridge_runs TO authenticated;
GRANT ALL ON public.sheet_bridge_runs TO service_role;
