import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/pricing/settings")({
  head: () => ({ meta: [{ title: "Pricing settings — PHC" }, { name: "robots", content: "noindex" }] }),
  component: () => null,
});
