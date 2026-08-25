import { createFileRoute, Navigate } from "@tanstack/react-router";

// Phase 2 (system-redesign request): "these 3 pages have the same purpose —
// keep only the one that works for sales and estimation monitoring." This
// page's full content moved, unchanged, to
// src/components/phc/pipeline/RfqJihPanel.tsx, now rendered as a tab on
// /quotations. This route stays as a redirect (not deleted) so old
// bookmarks/links to /rfq-jih keep working instead of 404ing.
//
// QA 2026-08-10 (ISSUE-003): see the matching note in boq.tsx. Throwing a
// redirect from `beforeLoad` under the `ssr: false` `_authenticated` layout
// blanked the page on a direct load; redirecting from the component is the
// pattern already proven by src/routes/index.tsx.
export const Route = createFileRoute("/_authenticated/rfq-jih")({
  component: () => <Navigate to="/quotations" search={{ tab: "rfq_jih" }} replace />,
});
