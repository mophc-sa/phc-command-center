// =============================================================================
// Unified "New Entry" dialog — Phase 2 of the client's system-redesign
// request: one entry point for the 5 previously-separate "New X" forms
// (Intake, Lead, RFQ, Quotation, BOQ), with a Record Type selector at the
// top that swaps the field set below it and routes the submission to the
// correct existing create* function. This is purely a new frontend routing
// layer — no new tables, no change to any existing create* function's
// behavior or the safeguards those already enforce (see inbox-actions.ts's
// header comment: nothing here bypasses the pipeline those functions guard).
//
// Not built on top of ActionDialog: ActionDialog's fields are a static
// array for the dialog's lifetime, but this dialog's field set must react
// live to the Record Type selector at its own top, which ActionDialog has
// no hook for. Rather than stretch that component's contract, this dialog
// owns its own form state and reuses the same UI primitives ActionDialog
// uses internally.
// =============================================================================

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { supabase } from "@/integrations/supabase/client";
import { listTeamMembers } from "@/lib/opportunity-actions";
import { createInboxItem, INBOX_SOURCE_TYPES } from "@/lib/inbox-actions";
import { newIntakeFields } from "@/routes/_authenticated/lead-tender-inbox";
import { createLead } from "@/lib/lead-actions";
import { createRfq, type RfqClassification } from "@/lib/rfq-actions";
import { createQuotation, createBoq, type BoqStatus } from "@/lib/sales-actions";
import { createCompany, createProject } from "@/lib/crm-actions";
import { ActionDialog, type DialogField } from "@/components/phc/ActionDialog";
import { canManageSalesPipeline, canEditTotalValue, canEditRfqNumber } from "@/lib/roles";

type CreateResolver = ((result: { value: string; label: string } | null) => void) | null;

function rfqClassifications(t: (k: string) => string): { value: RfqClassification; label: string }[] {
  return [
    { value: "jih", label: t("rfq_classification_jih") },
    { value: "tender", label: t("rfq_classification_tender") },
    { value: "other", label: t("rfq_classification_other_label") },
  ];
}

type EntryType = "intake" | "lead" | "rfq" | "quotation" | "boq";

const BOQ_STATUSES: BoqStatus[] = ["verified", "partially_verified", "estimated_scope", "missing"];

function leadFields(t: (k: string) => string): DialogField[] {
  return [
    { key: "projectName", type: "text", label: t("nav_projects"), required: true },
    {
      key: "source", type: "select", label: t("lead_source"), defaultValue: "manual",
      options: [
        { value: "manual", label: "Manual" },
        { value: "protenders", label: "ProTenders" },
        { value: "external", label: "External" },
      ],
    },
    { key: "sourceUrl", type: "text", label: "URL" },
    { key: "mainContractorGuess", type: "text", label: t("crm_main_contractor") },
    { key: "location", type: "text", label: t("crm_location") },
    { key: "estimatedValue", type: "text", label: t("lead_est_value") },
  ];
}

function rfqFields(
  t: (k: string) => string,
  companies: any[],
  projects: any[],
  teamMembers: any[],
  roles: import("@/lib/roles").AppRole[],
  setCreatingCompanyFor: (resolver: CreateResolver) => void,
  setCreatingProjectFor: (resolver: CreateResolver) => void,
): DialogField[] {
  const canAssignOwner = canManageSalesPipeline(roles);
  const canEditValue = canEditTotalValue(roles);
  const canEditNumber = canEditRfqNumber(roles);
  return [
    // Auto-generated unless the caller holds edit authority (server
    // enforces this too — see generate_rfq_number() trigger).
    ...(canEditNumber ? [{ key: "rfqNumber", type: "text" as const, label: "RFQ #" }] : []),
    {
      key: "companyId", type: "select", label: t("crm_company"),
      options: [{ value: "", label: "—" }, ...companies.map((c: any) => ({ value: c.id, label: c.name }))],
      createLabel: t("wf_add_new_company"),
      onCreateNew: () => new Promise((resolve) => setCreatingCompanyFor(() => resolve)),
    },
    {
      key: "projectId", type: "select", label: t("nav_projects"),
      options: [{ value: "", label: "—" }, ...projects.map((p: any) => ({ value: p.id, label: p.name }))],
      createLabel: t("wf_add_new_project"),
      onCreateNew: () => new Promise((resolve) => setCreatingProjectFor(() => resolve)),
    },
    { key: "city", type: "text", label: t("crm_location") },
    {
      key: "classification", type: "select", label: t("rfq_classification"),
      options: [{ value: "", label: "—" }, ...rfqClassifications(t)],
    },
    { key: "classificationOther", type: "text", label: t("rfq_classification_other") },
    { key: "receivedDate", type: "date", label: t("rfq_received_date") },
    { key: "responseDueDate", type: "date", label: t("wf_expected_contract") },
    ...(canAssignOwner ? [{
      key: "salesOwnerId", type: "select" as const, label: t("rfq_assigned_salesperson"),
      options: [{ value: "", label: "—" }, ...teamMembers.map((m: any) => ({ value: m.id, label: m.full_name || m.email }))],
    }] : []),
    // Total Value is Finance Manager / BD Manager / System Admin only —
    // enforced server-side too (protect_rfq_estimated_value trigger).
    ...(canEditValue ? [{ key: "estimatedValue", type: "text" as const, label: t("crm_total_value") }] : []),
  ];
}

function quotationFields(t: (k: string) => string, opps: any[]): DialogField[] {
  return [
    { key: "opportunityId", type: "select", label: t("field_opportunity"), required: true, options: opps.map((o: any) => ({ value: o.id, label: o.project_name })) },
    { key: "quoteNumber", type: "text", label: t("field_quote_number"), required: true },
    { key: "value", type: "text", label: t("field_value") },
    { key: "issuedDate", type: "date", label: t("field_issued_date") },
    { key: "validUntil", type: "date", label: t("field_valid_until") },
    { key: "notes", type: "textarea", label: t("field_notes") },
  ];
}

function boqFields(t: (k: string) => string, opps: any[]): DialogField[] {
  return [
    { key: "opportunityId", type: "select", label: t("field_opportunity"), required: true, options: opps.map((o: any) => ({ value: o.id, label: o.project_name })) },
    { key: "title", type: "text", label: t("field_boq_title"), required: true },
    {
      key: "status", type: "select", label: t("field_boq_status"), required: true, defaultValue: "estimated_scope",
      options: BOQ_STATUSES.map((s) => ({ value: s, label: t(`boq_status_${s}` as never) })),
    },
    { key: "source", type: "text", label: t("field_boq_source") },
    { key: "estimatedValue", type: "text", label: t("field_estimated_value") },
    { key: "assumptions", type: "textarea", label: t("field_assumptions") },
    { key: "missingItems", type: "textarea", label: t("field_missing_items") },
  ];
}

export function NewEntryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, dir } = useI18n();
  const qc = useQueryClient();
  const { user, roles } = useAuth();
  const uid = user?.id ?? "";
  const [entryType, setEntryType] = useState<EntryType>("intake");
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [extraOptions, setExtraOptions] = useState<Record<string, { value: string; label: string }[]>>({});
  const [creating, setCreating] = useState<string | null>(null);
  const [creatingCompanyFor, setCreatingCompanyFor] = useState<CreateResolver>(null);
  const [creatingProjectFor, setCreatingProjectFor] = useState<CreateResolver>(null);

  const { data: teamMembers = [] } = useQuery({ queryKey: ["team-members-min"], queryFn: listTeamMembers, enabled: open });
  const { data: companies = [] } = useQuery({
    queryKey: ["companies-min"],
    queryFn: async () => (await supabase.from("companies").select("id, name").order("name")).data ?? [],
    enabled: open,
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-min"],
    queryFn: async () => (await supabase.from("projects").select("id, name").order("name")).data ?? [],
    enabled: open,
  });
  const { data: opps = [] } = useQuery({
    queryKey: ["opps-for-quote"],
    queryFn: async () => (await supabase.from("opportunities").select("id, project_name").not("stage", "in", "(won,lost,archived)").order("project_name")).data ?? [],
    enabled: open,
  });

  const tt = (k: string) => t(k as never);
  const fields: DialogField[] =
    entryType === "intake" ? newIntakeFields(tt, teamMembers)
    : entryType === "lead" ? leadFields(tt)
    : entryType === "rfq" ? rfqFields(tt, companies, projects, teamMembers, roles, setCreatingCompanyFor, setCreatingProjectFor)
    : entryType === "quotation" ? quotationFields(tt, opps)
    : boqFields(tt, opps);

  useEffect(() => {
    if (!open) return;
    const seed: Record<string, string> = {};
    for (const f of fields) seed[f.key] = "defaultValue" in f ? (f.defaultValue ?? "") : "";
    setValues(seed);
    setErrors({});
    setExtraOptions({});
    // Re-seed whenever the record type changes so a field left over from
    // the previous type never leaks into the next type's submission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryType]);

  function clearFieldError(key: string) {
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit() {
    const newErrors: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && !values[f.key]) newErrors[f.key] = t("dialog_field_required");
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setBusy(true);
    try {
      if (entryType === "intake") {
        if (!values.sourceType) { toast.error(t("ibx_no_source")); setBusy(false); return; }
        await createInboxItem({
          sourceType: values.sourceType as never,
          sourceName: values.sourceName || undefined,
          dateReceived: values.dateReceived || undefined,
          companyName: values.companyName || undefined,
          contactName: values.contactName || undefined,
          phone: values.phone || undefined,
          email: values.email || undefined,
          clientType: values.clientType ? (values.clientType as never) : undefined,
          projectType: values.projectType ? (values.projectType as never) : undefined,
          projectName: values.projectName || undefined,
          projectNumber: values.projectNumber || undefined,
          rfqFrom: values.rfqFrom ? (values.rfqFrom as never) : undefined,
          clientOwner: values.clientOwner || undefined,
          mainContractor: values.mainContractor || undefined,
          consultant: values.consultant || undefined,
          scopeType: values.scopeType ? (values.scopeType as never) : undefined,
          locationCity: values.locationCity ? (values.locationCity as never) : undefined,
          estimatedValue: values.estimatedValue ? Number(values.estimatedValue) : null,
          deadline: values.deadline || null,
          notes: values.notes || undefined,
          evidenceUrl: values.evidenceUrl || undefined,
          assignedOwnerId: values.assignedOwnerId || uid,
          nextAction: values.nextAction || undefined,
          followUpDate: values.followUpDate || null,
        });
        toast.success(t("intake_created_location_hint"));
        qc.invalidateQueries({ queryKey: ["inbox-items"] });
      } else if (entryType === "lead") {
        await createLead({
          projectName: values.projectName,
          source: values.source || "manual",
          sourceUrl: values.sourceUrl || undefined,
          mainContractorGuess: values.mainContractorGuess || undefined,
          location: values.location || undefined,
          estimatedValue: values.estimatedValue ? Number(values.estimatedValue) : null,
        });
        toast.success(t("crm_saved"));
        qc.invalidateQueries({ queryKey: ["leads"] });
      } else if (entryType === "rfq") {
        await createRfq({
          rfqNumber: values.rfqNumber || undefined,
          companyId: values.companyId || null,
          projectId: values.projectId || null,
          city: values.city || null,
          classification: (values.classification || null) as RfqClassification | null,
          classificationOther: values.classificationOther || null,
          receivedDate: values.receivedDate || null,
          estimatedValue: values.estimatedValue ? Number(values.estimatedValue) : null,
          responseDueDate: values.responseDueDate || null,
          salesOwnerId: values.salesOwnerId || null,
          claimOwner: true,
        });
        toast.success(t("rfq_created_location_hint"));
        qc.invalidateQueries({ queryKey: ["rfqs-open"] });
      } else if (entryType === "quotation") {
        await createQuotation({
          opportunityId: values.opportunityId,
          quoteNumber: values.quoteNumber,
          value: values.value ? Number(values.value) : null,
          issuedDate: values.issuedDate || null,
          validUntil: values.validUntil || null,
          notes: values.notes || undefined,
        });
        toast.success(t("toast_quotation_created"));
        qc.invalidateQueries({ queryKey: ["quotations"] });
      } else {
        await createBoq({
          opportunityId: values.opportunityId,
          title: values.title,
          status: values.status as BoqStatus,
          source: values.source || undefined,
          estimatedValue: values.estimatedValue ? Number(values.estimatedValue) : null,
          assumptions: values.assumptions || undefined,
          missingItems: values.missingItems || undefined,
        });
        toast.success(t("crm_saved"));
        qc.invalidateQueries({ queryKey: ["boqs"] });
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={dir} className="flex flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("new_entry_title")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5 pb-2">
          <Label className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{t("new_entry_type")}</Label>
          <Select value={entryType} onValueChange={(v) => setEntryType(v as EntryType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="intake">{t("new_entry_type_intake")}</SelectItem>
              <SelectItem value="lead">{t("new_entry_type_lead")}</SelectItem>
              <SelectItem value="rfq">{t("new_entry_type_rfq")}</SelectItem>
              <SelectItem value="quotation">{t("new_entry_type_quotation")}</SelectItem>
              <SelectItem value="boq">{t("new_entry_type_boq")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className={"grid gap-4 overflow-y-auto py-2 sm:grid-cols-2 max-h-[50vh] pe-1"}>
          {fields.map((f) => (
            <div key={f.key} className={"grid gap-1.5" + (f.type === "textarea" ? " sm:col-span-2" : "")}>
              <Label htmlFor={f.key} className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                {f.label}
                {f.required ? <span aria-hidden="true"> *</span> : ""}
              </Label>
              {f.type === "textarea" ? (
                <Textarea
                  id={f.key}
                  value={values[f.key] ?? ""}
                  onChange={(e) => { setValues((v) => ({ ...v, [f.key]: e.target.value })); clearFieldError(f.key); }}
                  rows={3}
                />
              ) : f.type === "select" ? (
                <Select
                  value={values[f.key] ? values[f.key] : "__none__"}
                  onValueChange={async (v) => {
                    if (v === "__create__") {
                      if (!f.onCreateNew) return;
                      setCreating(f.key);
                      try {
                        const created = await f.onCreateNew();
                        if (created) {
                          setExtraOptions((prev) => ({ ...prev, [f.key]: [...(prev[f.key] ?? []), created] }));
                          setValues((prev) => ({ ...prev, [f.key]: created.value }));
                          clearFieldError(f.key);
                        }
                      } finally {
                        setCreating(null);
                      }
                      return;
                    }
                    setValues((prev) => ({ ...prev, [f.key]: v === "__none__" ? "" : v })); clearFieldError(f.key);
                  }}
                >
                  <SelectTrigger id={f.key} disabled={creating === f.key}>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {f.onCreateNew ? (
                      <SelectItem value="__create__">{f.createLabel ?? t("dialog_create_new")}</SelectItem>
                    ) : null}
                    {[...f.options, ...(extraOptions[f.key] ?? [])].map((o) => (
                      <SelectItem key={o.value === "" ? "__none__" : o.value} value={o.value === "" ? "__none__" : o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={f.key}
                  type={f.type === "date" ? "date" : "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => { setValues((v) => ({ ...v, [f.key]: e.target.value })); clearFieldError(f.key); }}
                />
              )}
              {errors[f.key] ? <p role="alert" className="text-xs text-destructive">{errors[f.key]}</p> : null}
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? t("loading") : t("crm_add")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Inline "add new company" from the RFQ company picker */}
    <ActionDialog
        open={!!creatingCompanyFor}
        onOpenChange={(o) => { if (!o) { creatingCompanyFor?.(null); setCreatingCompanyFor(null); } }}
        title={t("wf_add_new_company")}
        submitLabel={t("crm_add")}
        fields={[{ key: "name", type: "text", label: t("crm_company"), required: true }]}
        onSubmit={async (v) => {
          try {
            const company = await createCompany({ name: v.name, companyType: "target_account", claimOwner: true });
            creatingCompanyFor?.({ value: company.id, label: company.name });
            setCreatingCompanyFor(null);
          } catch (e) {
            // Resolve with null so the select doesn't stay stuck disabled
            // waiting on a promise that would otherwise never settle.
            creatingCompanyFor?.(null);
            setCreatingCompanyFor(null);
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />

      {/* Inline "add new project" from the RFQ project picker */}
      <ActionDialog
        open={!!creatingProjectFor}
        onOpenChange={(o) => { if (!o) { creatingProjectFor?.(null); setCreatingProjectFor(null); } }}
        title={t("wf_add_new_project")}
        submitLabel={t("crm_add")}
        fields={[{ key: "name", type: "text", label: t("nav_projects"), required: true }]}
        onSubmit={async (v) => {
          try {
            const project = await createProject({ name: v.name });
            creatingProjectFor?.({ value: project.id, label: project.name });
            setCreatingProjectFor(null);
          } catch (e) {
            creatingProjectFor?.(null);
            setCreatingProjectFor(null);
            toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : ""));
          }
        }}
      />
    </>
  );
}
