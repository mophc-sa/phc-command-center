import { createFileRoute, redirect } from "@tanstack/react-router";

// Phase 2 (system-redesign request): "these 3 pages have the same purpose —
// keep only the one that works for sales and estimation monitoring." This
// page's full content moved, unchanged, to
// src/components/phc/pipeline/RfqJihPanel.tsx, now rendered as a tab on
// /quotations. This route stays as a redirect (not deleted) so old
// bookmarks/links to /rfq-jih keep working instead of 404ing.
export const Route = createFileRoute("/_authenticated/rfq-jih")({
  beforeLoad: () => {
    throw redirect({ to: "/quotations", search: { tab: "rfq_jih" } });
  },
});
