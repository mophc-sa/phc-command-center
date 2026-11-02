import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonForm } from "@/components/phc/Skeleton";
import { useI18n } from "@/lib/i18n";
import { normaliseProjectCode } from "@/lib/short-link";

// /p/FA-26-0001 -> the deal. See short-link.ts.
export const Route = createFileRoute("/_authenticated/p/$code")({
  head: () => ({ meta: [{ title: "PHC" }, { name: "robots", content: "noindex" }] }),
  component: ShortLinkPage,
});

function ShortLinkPage() {
  const { code: raw } = Route.useParams();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const code = normaliseProjectCode(raw);

  const target = useQuery({
    queryKey: ["short-link", code],
    enabled: !!code,
    queryFn: async (): Promise<string | null> => {
      const { data: rfq, error } = await supabase
        .from("rfqs")
        .select("opportunity_id")
        .eq("rfq_number", code!)
        .maybeSingle();
      if (error) throw error;
      if (!rfq?.opportunity_id) return null;
      // Read the deal itself as this person. RFQs and deals have different
      // read rules; the deal's is the one that decides whether it opens.
      const { data: opp, error: oppError } = await supabase
        .from("opportunities")
        .select("id")
        .eq("id", rfq.opportunity_id)
        .maybeSingle();
      if (oppError) throw oppError;
      return opp?.id ?? null;
    },
  });

  const id = target.data;
  useEffect(() => {
    // Replace, so Back returns to where the link was clicked rather than to a
    // page that only forwards again.
    if (id) void navigate({ to: "/opportunities/$id", params: { id }, replace: true });
  }, [id, navigate]);

  if (code && (target.isLoading || id)) return <SkeletonForm />;

  return (
    <div className="mx-auto max-w-7xl">
      <EmptyState
        message={t("not_found")}
        hint={
          lang === "ar"
            ? "لا يوجد مشروع بهذا الكود، أو ليست لديك صلاحية فتحه."
            : "No deal has this code, or you do not have access to it."
        }
      />
      <div className="mt-4 text-center">
        <Link to="/opportunities" className="text-sm text-primary underline-offset-2 hover:underline">
          {t("nav_opportunities")}
        </Link>
      </div>
    </div>
  );
}
