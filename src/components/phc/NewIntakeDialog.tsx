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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { useI18n } from "@/lib/i18n";
import { countReferences } from "@/lib/reference-hint";
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

// WHAT IS MANDATORY, AND WHY THAT LIST
//
// Asked for on 2026-09-02: "the entry form should have required fields such as
// name, phone, email, and whatever else fits the context."
//
// Five, not more. Each one is something the next person cannot do their job
// without, and nothing is required merely because it would be nice to have:
//
//   sourceType    already enforced, and it decides the routing
//   companyName   an item with no company cannot be matched to an account
//   contactName   somebody has to be called back
//   phone         and there has to be a way to call them
//   projectName   the record's own name; without it the list is unreadable
//
// Email is deliberately NOT required. Plenty of contractor site contacts have a
// phone and no address, and a required email teaches people to type
// x@x.com -- which is worse than an empty column, because it looks like data.
export function newIntakeFields(
  t: (k: string) => string,
  teamMembers: any[],
  known: { companies: string[]; projects: string[]; references: string[] } = { companies: [], projects: [], references: [] },
): DialogField[] {
  return [
    { key: "sourceType", type: "select", label: t("ibx_source_type"), required: true, options: INBOX_SOURCE_TYPES.map((s) => ({ value: s, label: t(`src_${s}`) })) },
    { key: "dateReceived", type: "date", label: t("ibx_date_received"), defaultValue: new Date().toISOString().slice(0, 10) },
    // The only place a duplicate company can be PREVENTED. Once two rows exist
    // for one contractor, every report that groups by client is wrong and no
    // care downstream repairs it.
    { key: "companyName", type: "autocomplete", label: t("ibx_company_name"), required: true,
      suggestions: known.companies, knownHint: t("ibx_company_known"),
      // "the reference should be active — if the company is registered it
      // appears automatically". The reference that matters is PHC's own past
      // work for them: a rep pricing an RFQ from a contractor we have already
      // built for should know it before they quote, not after.
      hintFor: (v) => {
        const n = countReferences(known.references, v);
        return n === 0 ? null : t("ibx_company_references").replace("{n}", String(n));
      } },
    { key: "contactName", type: "text", label: t("ibx_contact_name"), required: true },
    { key: "phone", type: "phone", label: t("label_phone"), required: true },
    { key: "email", type: "text", label: t("email") },
    { key: "clientType", type: "select", label: t("ibx_client_type"), options: [{ value: "", label: "—" }, ...INBOX_CLIENT_TYPES.map((c) => ({ value: c, label: t(`ibx_client_type_${c}`) }))] },
    // Every "other" carries somewhere to say what it was. Required, because an
    // unexplained "other" is the same dead end as the closed list it replaced.
    { key: "clientTypeOther", type: "text", label: t("ibx_client_type_specify"), required: true, showWhen: { field: "clientType", equals: "other" } },
    // The routing decision. With a project name alongside it, this is what
    // sends the item down the RFQ track or the tender track — no separate
    // classify step. Leave it blank and the item waits in the inbox instead.
    // Phase 2 (PRD §12): four request types, not two. Both tender subtypes
    // route to the tender board — the split is commercial, not structural: a
    // government/owner pre-award tender has no appointed contractor to quote
    // to yet, which is a different job from chasing a contractor who is bidding.
    { key: "requestType", type: "select", label: t("ibx_request_type"), options: [{ value: "", label: "—" }, ...INTAKE_REQUEST_TYPES.map((r) => ({ value: r, label: t(`ibx_request_type_${r}`) }))] },
    { key: "projectName", type: "autocomplete", label: t("label_project"), required: true,
      suggestions: known.projects, knownHint: t("ibx_project_known") },
    // Project Number intentionally omitted — auto-generated server-side
    // (INT-{year}-{seq}, generate_inbox_project_number() trigger),
    // not typed manually (2026-08-03).
    { key: "rfqFrom", type: "select", label: t("ibx_rfq_from"), options: [{ value: "", label: "—" }, ...INBOX_RFQ_FROM.map((r) => ({ value: r, label: t(`ibx_rfq_from_${r}`) }))] },
    { key: "rfqFromOther", type: "text", label: t("ibx_rfq_from_specify"), required: true, showWhen: { field: "rfqFrom", equals: "other" } },
    { key: "clientOwner", type: "text", label: t("ibx_client_owner") },
    { key: "mainContractor", type: "text", label: t("label_contractor") },
    { key: "consultant", type: "text", label: t("ibx_consultant") },
    { key: "ownerEntity", type: "text", label: t("ibx_owner_entity") },
    { key: "clientRfqReference", type: "text", label: t("ibx_client_rfq_ref") },
    { key: "internalRfqReference", type: "text", label: t("ibx_internal_rfq_ref") },
    { key: "scopeType", type: "select", label: t("ibx_scope_type"), options: [{ value: "", label: "—" }, ...INBOX_SCOPES.map((s) => ({ value: s, label: t(`ibx_scope_${s}`) }))] },
    { key: "scopeTypeOther", type: "text", label: t("ibx_scope_specify"), required: true, showWhen: { field: "scopeType", equals: "other" } },
    { key: "locationCity", type: "select", label: t("ibx_location_city"), options: [{ value: "", label: "—" }, ...INBOX_LOCATIONS.map((l) => ({ value: l, label: t(`ibx_location_${l}`) }))] },
    { key: "locationOther", type: "text", label: t("ibx_location_specify"), required: true, showWhen: { field: "locationCity", equals: "other" } },
    // Estimated Value intentionally omitted here — per 2026-08-03 client
    // request, it's now a later-stage field set by Finance
    // (opportunities/rfqs.estimated_value, gated by can_edit_total_value —
    // see canEditTotalValue in src/lib/roles.ts), not captured at intake.
    { key: "deadline", type: "date", label: t("ibx_deadline") },
    // What arrived with the request. Booleans, not a document registry — the
    // document layer is a later phase; the review gate only needs to know
    // whether the package is complete enough to price.
    // Whether the client runs RFQs through the SAAB ARABIA portal changes how
    // the quotation has to be submitted, and there was nowhere to record it.
    { key: "saabPortal", type: "checkbox", label: t("ibx_saab_portal") },
    // Signage is late-stage work: a project at 30% and one at 85% are different
    // opportunities on the same day. Left blank means nobody said -- not zero.
    { key: "completionPct", type: "text", label: t("ibx_completion_pct"), placeholder: "0-100" },
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

  // 249 companies and 741 projects: fetched once and matched in memory, so
  // there is no request per keystroke and no reason to make anyone guess.
  // `enabled: open` keeps the two reads off every page that mounts the header.
  const { data: known = { companies: [], projects: [], references: [] } } = useQuery({
    queryKey: ["intake-known-names"],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [c, o, r] = await Promise.all([
        supabase.from("companies").select("name").order("name"),
        supabase.from("opportunities").select("project_name").order("project_name"),
        supabase.from("reference_projects").select("client_or_contractor"),
      ]);
      const uniq = (xs: (string | null)[]) =>
        [...new Set(xs.filter((x): x is string => !!x && x.trim() !== ""))];
      return {
        companies: uniq((c.data ?? []).map((r: { name: string | null }) => r.name)),
        projects: uniq((o.data ?? []).map((x: { project_name: string | null }) => x.project_name)),
        // NOT de-duplicated: three past projects for one client is three, and
        // that count is the whole point of the line.
        references: (r.data ?? [])
          .map((x: { client_or_contractor: string | null }) => x.client_or_contractor)
          .filter((x): x is string => !!x && x.trim() !== ""),
      };
    },
  });

  return (
    <ActionDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("ibx_new_item")}
      // Twenty fields. Losing them to a closed tab is the reported defect.
      draftId="intake"
      description={t("intake_routes_itself")}
      submitLabel={t("crm_add")}
      fields={newIntakeFields((k) => t(k as never), teamMembers, known)}
      onSubmit={async (v) => {
        if (!v.sourceType) { toast.error(t("ibx_no_source")); return; }
        // A percentage or nothing. The database rejects anything else anyway;
        // saying so here costs a round trip less and names the field.
        const pct = v.completionPct?.trim();
        if (pct && !/^\d{1,3}$/.test(pct)) { toast.error(t("ibx_completion_invalid")); return; }
        if (pct && Number(pct) > 100) { toast.error(t("ibx_completion_invalid")); return; }
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
            clientTypeOther: v.clientTypeOther || undefined,
            rfqFromOther: v.rfqFromOther || undefined,
            scopeTypeOther: v.scopeTypeOther || undefined,
            locationOther: v.locationOther || undefined,
            saabPortal: v.saabPortal === "true",
            // Blank means nobody said, which is not zero. `Number("")` is 0, so
            // the emptiness has to be checked before the conversion.
            completionPct: v.completionPct?.trim() ? Number(v.completionPct) : undefined,
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
