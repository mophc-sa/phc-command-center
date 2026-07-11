import { createFileRoute, Outlet } from "@tanstack/react-router";

// Layout route for /accounts — renders the matched child (the list at
// /accounts, or the detail page at /accounts/$id) via <Outlet />. Without
// this, accounts.$id.tsx (a child route of this one) matches but has
// nowhere to render, and the parent's own component — previously the list
// page rendered directly here — always wins.
export const Route = createFileRoute("/_authenticated/accounts")({
  component: () => <Outlet />,
});
