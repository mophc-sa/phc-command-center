-- =========================================================
-- PHASE 6 — Location foundation. Two tables, four columns, no PostGIS.
--
-- WHICH ENTITIES, AND WHY ONLY THESE
-- ----------------------------------
-- The schema already carries a location TEXT on opportunities, projects,
-- inbox_items, leads and boq_items, plus city on rfqs and vendors. The gap is
-- not "somewhere to write the address" — it is coordinates, and coordinates are
-- only worth having where something is physically visited.
--
--   projects    YES. A signage project is a place. Surveyors go to it,
--               installers go to it, and photos are taken there. This is the
--               site of record, and it is the one row that outlives the deal.
--
--   documents   YES, but a different fact. A photo of the north entrance sign
--               was taken at the north entrance, not at the project's pin. One
--               project, many capture points — so the coordinate belongs to the
--               photo. Already added by the registry migration; this one adds
--               the index and the reader.
--
-- And deliberately not:
--
--   opportunities  it has location TEXT and it becomes a project when it is
--                  real. Coordinates here would be a second copy of the site
--                  that has to be kept in step with the project's, for a record
--                  that may never have a site at all.
--   rfqs, inbox_items, leads   intake. An address typed off an email is not a
--                  surveyed coordinate, and pretending otherwise puts a pin on
--                  a map that nobody checked.
--   companies, contacts        business addresses, not sites.
--   boq_items      `location` there means "level 3, west corridor" — a position
--                  inside a building, not a point on the earth.
--
-- WHY NUMERIC(9,6) AND NOT PostGIS
-- --------------------------------
-- Six decimal places is about 11cm at the equator, which is finer than any
-- consumer GPS fix and far finer than "where is this sign". PostGIS buys
-- distance queries, containment and projection — none of which anything in this
-- system asks for yet, and all of which cost an extension on the production
-- database. When something needs "sites within 40km", that is the moment.
--
-- No maps provider and no geocoding: both are outbound calls, both need a key,
-- and neither is required to record where something is.
--
-- LOCAL ONLY — not applied to any remote project by this change.
-- =========================================================

-- ============ 1. The site ============
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS site_latitude   NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS site_longitude  NUMERIC(9,6),
  -- `location` already exists and holds whatever was typed at intake. This is
  -- the tidied, confirmed version — kept separate so nobody has to decide
  -- whether overwriting the original loses something.
  ADD COLUMN IF NOT EXISTS site_address    TEXT;

DO $$ BEGIN
  ALTER TABLE public.projects ADD CONSTRAINT projects_site_lat_range
    CHECK (site_latitude IS NULL OR (site_latitude BETWEEN -90 AND 90));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.projects ADD CONSTRAINT projects_site_lon_range
    CHECK (site_longitude IS NULL OR (site_longitude BETWEEN -180 AND 180));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Half a coordinate is not a location. Storing latitude alone is the kind of
-- thing that survives for months and then produces a pin in the Gulf of Guinea.
DO $$ BEGIN
  ALTER TABLE public.projects ADD CONSTRAINT projects_site_latlon_together
    CHECK ((site_latitude IS NULL) = (site_longitude IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.projects.site_latitude IS
  'Confirmed site coordinate, WGS84. NUMERIC(9,6) — about 11cm, finer than any GPS fix this needs. Null means nobody has recorded one; it does not mean the project has no site.';
COMMENT ON COLUMN public.projects.site_address IS
  'The tidied site address. Separate from projects.location, which holds whatever was typed at intake and is left alone.';

-- Only the located rows are worth indexing; most projects will have no
-- coordinate for a long time.
CREATE INDEX IF NOT EXISTS projects_located
  ON public.projects (site_latitude, site_longitude)
  WHERE site_latitude IS NOT NULL;

-- ============ 2. The photo's own point ============
-- The columns live on documents (added with the registry, since the constraints
-- belong with the table). This is the index that makes "photos of this site"
-- answerable without scanning every document.
CREATE INDEX IF NOT EXISTS documents_geotagged
  ON public.documents (captured_lat, captured_lon)
  WHERE captured_lat IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.documents.captured_lat IS
  'Where a photo was taken, WGS84. Deliberately distinct from the project site: one project has many capture points. Null for everything that is not a geotagged photo.';
