import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/phc/PageHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { InvitationForm } from "@/components/phc/supplier/InvitationForm";
import { useI18n } from "@/lib/i18n";
import { dbMessage, pick, type Bi } from "@/lib/pricing-text";
import { getPortalInvitation } from "@/lib/supplier-portal-actions";

export const Route = createFileRoute("/supplier/$invitationId")({
  component: SupplierInvitationPage,
});

const TEXT = {
  eyebrow: { en: "Pricing request", ar: "طلب تسعير" },
  back: { en: "All requests", ar: "كل الطلبات" },
  unavailable: { en: "This request is not available", ar: "هذا الطلب غير متاح" },
  notFound: { en: "Request not found. Check the link you were sent.", ar: "الطلب غير موجود. تحقق من الرابط الذي وصلك." },
} satisfies Record<string, Bi>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function SupplierInvitationPage() {
  const { invitationId } = Route.useParams();
  const { lang } = useI18n();
  const validId = UUID.test(invitationId);
  // Not retried: "not available" is an answer, not a network error.
  const inv = useQuery({ queryKey: ["supplier-portal-invitation", invitationId], queryFn: () => getPortalInvitation(invitationId), retry: false, enabled: validId });
  const back = <Link to="/supplier" className="text-sm underline-offset-2 hover:underline">{pick(TEXT.back, lang)}</Link>;

  if (!validId) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState variant="error" title={pick(TEXT.unavailable, lang)} description={pick(TEXT.notFound, lang)} />
      </div>
    );
  }
  if (inv.isLoading) return <SkeletonTable rows={5} />;
  if (inv.isError || !inv.data) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState variant="error" title={pick(TEXT.unavailable, lang)} description={inv.error ? dbMessage(inv.error, lang) : undefined} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {back}
      <PageHeader eyebrow={pick(TEXT.eyebrow, lang)} title={<span dir="ltr">{inv.data.project_code}</span>} />
      <InvitationForm key={inv.data.invitation_id + inv.data.status} invitation={inv.data} />
    </div>
  );
}
