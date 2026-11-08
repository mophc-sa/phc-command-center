import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/phc/PageHeader";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { StatusPill } from "@/components/phc/StatusPill";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { useI18n, localeFor, formatNumber } from "@/lib/i18n";
import { daysLeft, PORTAL_STATUS_LABEL, riyadhToday, type PortalStatus } from "@/lib/supplier-portal";
import { listPortalInvitations } from "@/lib/supplier-portal-actions";
import { pick, type Bi } from "@/lib/pricing-text";

export const Route = createFileRoute("/supplier/")({
  component: SupplierInvitationsPage,
});

const TEXT = {
  title: { en: "Pricing requests", ar: "طلبات التسعير" },
  sub: { en: "Price only from the files attached to each request. Write any material or spec difference on its line.", ar: "سعّر فقط من الملفات المرفقة بكل طلب، واكتب أي اختلاف في الخامة أو المواصفة على سطره." },
  project: { en: "Project", ar: "المشروع" },
  replyBy: { en: "Reply by", ar: "موعد الرد" },
  status: { en: "Status", ar: "الحالة" },
  lines: { en: "Lines", ar: "البنود" },
  open: { en: "open", ar: "مفتوحة" },
  late: { en: "late", ar: "متأخر" },
  empty: { en: "No pricing request yet", ar: "لا طلبات تسعير بعد" },
  emptyHint: { en: "PHC will send you a link when a request is ready.", ar: "سترسل لكم PHC رابطاً عندما يجهز طلب." },
} satisfies Record<string, Bi>;

const TONE: Record<PortalStatus, "attention" | "positive" | "muted" | "neutral"> = {
  open: "attention",
  returned: "attention",
  submitted: "positive",
  closed: "muted",
};

function SupplierInvitationsPage() {
  const { lang } = useI18n();
  const list = useQuery({ queryKey: ["supplier-portal-list"], queryFn: listPortalInvitations });
  const today = riyadhToday();
  return (
    <div className="space-y-4">
      <PageHeader title={pick(TEXT.title, lang)} description={pick(TEXT.sub, lang)} />
      {list.isLoading ? <SkeletonTable rows={4} /> : null}
      {list.isError ? <QueryFailure retry={() => void list.refetch()} /> : null}
      {list.data && list.data.length === 0 ? (
        <EmptyState icon={Inbox} title={pick(TEXT.empty, lang)} description={pick(TEXT.emptyHint, lang)} />
      ) : null}
      {list.data && list.data.length > 0 ? (
        <Panel title={pick(TEXT.title, lang)}>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{pick(TEXT.project, lang)}</TableHead>
                  <TableHead>{pick(TEXT.replyBy, lang)}</TableHead>
                  <TableHead>{pick(TEXT.status, lang)}</TableHead>
                  <TableHead className="text-end">{pick(TEXT.lines, lang)}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.map((r) => {
                  const active = r.status === "open" || r.status === "returned";
                  return (
                    <TableRow key={r.invitation_id}>
                      <TableCell>
                        <Link to="/supplier/$invitationId" params={{ invitationId: r.invitation_id }} className="font-medium underline-offset-2 hover:underline" dir="ltr">
                          {r.project_code}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {new Date(`${r.reply_by}T00:00:00`).toLocaleDateString(localeFor(lang))}
                        {active && daysLeft(r.reply_by, today) < 0 ? <StatusPill tone="danger" className="ms-2">{pick(TEXT.late, lang)}</StatusPill> : null}
                      </TableCell>
                      <TableCell><StatusPill tone={TONE[r.status]}>{pick(PORTAL_STATUS_LABEL[r.status], lang)}</StatusPill></TableCell>
                      <TableCell className="text-end tabular-nums">
                        {formatNumber(r.lines, lang)}
                        {active ? ` · ${formatNumber(r.open_lines, lang)} ${pick(TEXT.open, lang)}` : ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
