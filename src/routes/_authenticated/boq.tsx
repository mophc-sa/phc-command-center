import { createFileRoute, Navigate } from "@tanstack/react-router";

// Phase 2 (system-redesign request): "these 3 pages have the same purpose —
// keep only the one that works for sales and estimation monitoring." This
// page's full content moved, unchanged, to
// src/components/phc/pipeline/BoqPanel.tsx, now rendered as a tab on
// /quotations. This route stays as a redirect (not deleted) so old
// bookmarks/links to /boq keep working instead of 404ing.
//
// QA 2026-08-10 (ISSUE-003): the redirect used to be `throw redirect(...)`
// from `beforeLoad`. Every parent here sits under `_authenticated`, which is
// `ssr: false` — the server ships a shell for /boq and the client then throws
// the redirect during hydration. That left the Suspense tree unresolved and
// rendered a blank page ("Uncaught undefined"), so a bookmark to /boq was a
// white screen while the in-app tab worked fine. Redirecting from the
// component instead is the pattern already proven by src/routes/index.tsx,
// which redirects client-side for the same `ssr: false` reason.
export const Route = createFileRoute("/_authenticated/boq")({
  component: () => <Navigate to="/quotations" search={{ tab: "boq" }} replace />,
});
