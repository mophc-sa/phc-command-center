import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// =============================================================================
// WHY THESE DEFAULTS EXIST
//
// The Supabase project runs in ap-northeast-1 (Tokyo) and the people using this
// run from Saudi Arabia, so every data call costs ~360ms warm and close to a
// second cold. That is fixed geography — but how OFTEN we pay it is not.
//
// `new QueryClient()` with no options takes React Query's defaults, which are
// tuned for a fast local API and are exactly wrong here:
//
//   staleTime: 0             every query is stale the instant it resolves, so
//                            every remount refetches. My Workspace alone issues
//                            20 queries, none of which set their own staleTime,
//                            so navigating away and back re-paid ~20 round trips
//                            every single time.
//   refetchOnWindowFocus     alt-tabbing to Outlook and back refetched the whole
//                            page.
//   retry: 3                 a genuinely failing request took three attempts with
//                            exponential backoff before the user saw an error.
//
// The result was a system that felt slow everywhere while the database itself is
// tiny (the largest table holds ~1,700 rows and opportunities holds four). The
// cost was never query time; it was the number of times we crossed the planet.
//
// Freshness is not sacrificed: every mutation path in this codebase calls
// queryClient.invalidateQueries, and invalidation ignores staleTime. So a user
// who changes something still sees it immediately — what stops is the
// re-fetching of data nobody changed.
// =============================================================================

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // A minute of reuse. Long enough that moving between pages is instant,
        // short enough that a colleague's change appears without a reload.
        staleTime: 60_000,
        // Keep unmounted data around so going back to a page is free.
        gcTime: 5 * 60_000,
        // Returning to the tab should not re-download the application.
        refetchOnWindowFocus: false,
        // Reconnecting after a dropped connection is the one case where
        // refetching is genuinely what the user wants.
        refetchOnReconnect: true,
        // One retry absorbs a blip; three just delays the error message.
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Hovering a nav link prefetches the route; 30s of reuse means the click
    // that follows is instant instead of repeating the fetch.
    defaultPreloadStaleTime: 30_000,
  });

  return router;
};
