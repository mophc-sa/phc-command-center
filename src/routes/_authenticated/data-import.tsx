import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route for /data-import — renders the matched child (the list at
// /data-import, or the detail page at /data-import/$batchId) via <Outlet />.
// Without this, data-import.$batchId.tsx (a child route) matches but has
// nowhere to render, and the parent's own component always wins.
function DataImportLayout() {
  return <Outlet />;
}

export const Route = createFileRoute("/_authenticated/data-import")({
  component: DataImportLayout,
});
