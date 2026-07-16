import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route for /data-import — renders the matched child (the list at
// /data-import, or the detail page at /data-import/$batchId) via <Outlet />.
// Without this, data-import.$batchId.tsx (a child route) matches but has
// nowhere to render, and the parent's own component always wins.

// Phase 1.1 safety gate: Controlled CRM commit is not enabled yet.
// The commit-to-CRM pathway (writing validated import rows into live CRM
// tables) is reserved for Phase 2, which requires a separate product
// approval. Until then the action is intentionally blocked at every layer:
// the edge function has no "commit" handler, and the UI button is disabled.
function Phase1CommitGate() {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title="Controlled CRM commit is not enabled yet — available in Phase 2"
      style={{ display: "none" }}
    >
      Commit to CRM
    </button>
  );
}

function DataImportLayout() {
  return (
    <>
      {/* Phase 1.1: Controlled CRM commit is not enabled yet. */}
      <Phase1CommitGate />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute("/_authenticated/data-import")({
  component: DataImportLayout,
});
