// PHC Sales OS — the single entry form.
//
// One form for everything that arrives: an RFQ, a tender, a market signal, a
// half-captured lead. It reads its own classification out of the fields the
// user filled in (§25.3, see D8) and carries the item straight onto the right
// track — RFQ to an opportunity in the pipeline (§25.2, §25.10), tender to the
// monitoring board (§3, §27).
//
// There was briefly a second "+ New RFQ" form beside this one, built to satisfy
// §6/§24. It was removed on the user's instruction (2026-08-05): two forms
// covering the same ground is worse than one that routes itself, and this form
// already carries every §24 field and more. §6's requirement — a creation entry
// point reachable from anywhere — is met by mounting this in the shell header
// instead. See D11.
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { listTeamMembers } from "@/lib/opportunity-actions";
import {
  createInboxItemAndRoute,
  INBOX_SOURCE_TYPES,
  INBOX_CLIENT_TYPES,
  INTAKE_REQUEST_TYPES,
  INBOX_RFQ_FROM,
  INBOX_SCOPES,
  INBOX_LOCATIONS,
} from "@/lib/inbox-actions";

export function newIntakeFields(t: (k: string) => string, teamMembers: any[]): DialogField[] {
  return [
    { key: "sourceType", type: "select", label: t("ibx_source_type"), required: true, options: INBOX_SOURCE_TYPES.map((s) => ({ value: s, label: t(`src_${s}`) })) },
    { key: "dateReceived", type: "date", label: t("ibx_date_received"), defaultValue: new Date().toISOString().slice(0, 10) },
    { key: "companyName", type: "text", label: t("ibx_company_name") },
    { key: "contactName", type: "text", label: t("ibx_contact_name") },
    { key: "phone", type: "text", label: t("label_phone") },
    { key: "email", type: "text", label: t("email") },
    { key: "clientType", type: "select", label: t("ibx_client_type"), options: [{ value: "", label: "—" }, ...INBOX_CLIENT_TYPES.map((c) => ({ value: c, label: t(`ibx_client_type_${c}`) }))] },
    // The routing decision. With a project name alongside it, this is what
    // sends the item down the RFQ track or the tender track — no separate
    // classify step. Leave it blank and the item waits in the inbox instead.
    // Phase 2 (PRD §12): four request types, not two. Both tender subtypes
    // route to the tender board — the split is commercial, not structural: a
    // government/owner pre-award tender has no appointed contractor to quote
    // to yet, which is a different job from chasing a contractor who is bidding.
    { key: "requestType", type: "select", label: t("ibx_request_type"), options: [{ value: "", label: "—" }, ...INTAKE_REQUEST_TYPES.map((r) => ({ value: r, label: t(`ibx_request_type_${r}`) }))] },
    { key: "projectName", type: "text", label: t("label_project") },
    // Project Number intentionally omitted — auto-generated server-side
    // (INT-{year}-{seq}, generate_inbox_project_number() trigger),
    // not typed manually (2026-08-03).
    { key: "rfqFrom", type: "select", label: t("ibx_rfq_from"), options: [{ value: "", label: "—" }, ...INBOX_RFQ_FROM.map((r) => ({ value: r, label: t(`ibx_rfq_from_${r}`) }))] },
    { key: "clientOwner", type: "text", label: t("ibx_client_owner") },
    { key: "mainContractor", type: "text", label: t("label_contractor") },
    { key: "consultant", type: "text", label: t("ibx_consultant") },
    { key: "ownerEntity", type: "text", label: t("ibx_owner_entity") },
    { key: "clientRfqReference", type: "text", label: t("ibx_client_rfq_ref") },
    { key: "internalRfqReference", type: "text", label: t("ibx_internal_rfq_ref") },
    { key: "scopeType", type: "select", label: t("ibx_scope_type"), options: [{ value: "", label: "—" }, ...INBOX_SCOPES.map((s) => ({ value: s, label: t(`ibx_scope_${s}`) }))] },
    { key: "locationCity", type: "select", label: t("ibx_location_city"), options: [{ value: "", label: "—" }, ...INBOX_LOCATIONS.map((l) => ({ value: l, label: t(`ibx_location_${l}`) }))] },
    // Estimated Value intentionally omitted here — per 2026-08-03 client
    // request, it's now a later-stage field set by Finance
    // (opportunities/rfqs.estimated_value, gated by can_edit_total_value —
    // see canEditTotalValue in src/lib/roles.ts), not captured at intake.
    { key: "deadline", type: "date", label: t("ibx_deadline") },
    // What arrived with the request. Booleans, not a document registry — the
    // document layer is a later phase; the review gate only needs to know
    // whether the package is complete enough to price.
    { key: "hasBoq", type: "checkbox", label: t("ibx_has_boq") },
    { key: "hasDrawings", type: "checkbox", label: t("ibx_has_drawings") },
    { key: "hasSpecs", type: "checkbox", label: t("ibx_has_specs") },
    { key: "notes", type: "textarea", label: t("wf_notes") },
    { key: "evidenceUrl", type: "file_or_url", label: t("ibx_evidence_url"), folder: "inbox" },
    { key: "assignedOwnerId", type: "select", label: t("ibx_assigned_owner"), options: [{ value: "", label: "—" }, ...teamMembers.map((p: any) => ({ value: p.id, label: p.full_name || p.email }))] },
    { key: "nextAction", type: "text", label: t("label_next_action") },
    { key: "followUpDate", type: "date", label: t("ibx_follow_up_date") },
  ];
}

export function NewIntakeDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Optional: let the host refresh its own list instead of navigating away. */
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: teamMembers = [] } = useQuery({ queryKey: ["team-members-min"], queryFn: listTeamMembers });

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("ibx_new_item")}
      description={t("intake_routes_itself")}
      submitLabel={t("crm_add")}
      fields={newIntakeFields((k) => t(k as never), teamMembers)}
      onSubmit={async (v) => {
        if (!v.sourceType) { toast.error(t("ibx_no_source")); return; }
        try {
          const res = await createInboxItemAndRoute({
            sourceType: v.sourceType as never,
            sourceName: v.sourceName || undefined,
            dateReceived: v.dateReceived || undefined,
            companyName: v.companyName || undefined,
            contactName: v.contactName || undefined,
            phone: v.phone || undefined,
            email: v.email || undefined,
            clientType: v.clientType ? (v.clientType as never) : undefined,
            requestType: v.requestType ? (v.requestType as never) : undefined,
            ownerEntity: v.ownerEntity || undefined,
            clientRfqReference: v.clientRfqReference || undefined,
            internalRfqReference: v.internalRfqReference || undefined,
            hasBoq: v.hasBoq === "true",
            hasDrawings: v.hasDrawings === "true",
            hasSpecs: v.hasSpecs === "true",
            projectName: v.projectName || undefined,
            rfqFrom: v.rfqFrom ? (v.rfqFrom as never) : undefined,
            clientOwner: v.clientOwner || undefined,
            mainContractor: v.mainContractor || undefined,
            consultant: v.consultant || undefined,
            scopeType: v.scopeType ? (v.scopeType as never) : undefined,
            locationCity: v.locationCity ? (v.locationCity as never) : undefined,
            deadline: v.deadline || null,
            notes: v.notes || undefined,
            evidenceUrl: v.evidenceUrl || undefined,
            assignedOwnerId: v.assignedOwnerId || undefined,
            nextAction: v.nextAction || undefined,
            followUpDate: v.followUpDate || null,
          });

          for (const key of [
            "inbox-items", "opportunities", "rfqs", "tenders",
            "ws-urgent-rfqs", "ws-rfqs", "ws-jih", "ws-stage-opps", "cc-core",
          ]) {
            qc.invalidateQueries({ queryKey: [key] });
          }
          onSaved?.();
          onOpenChange(false);

          // Phase 2: the save no longer converts anything, so there is no
          // record to land on. It goes to the review queue and the message
          // says so — silently returning would look like nothing happened.
          toast.success(t("intake_sent_for_review"));
          void navigate({ to: "/lead-tender-inbox" });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t("error_generic"));
        }
      }}
    />
  );
}
