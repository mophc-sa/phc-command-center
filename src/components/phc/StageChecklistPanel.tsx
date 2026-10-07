// =============================================================================
// Stage checklist on the deal page: the "evidence of done" for the current
// stage. Auto items are read from the deal's data (✓ or –, not editable);
// manual items are checkboxes with an optional note, saved through
// set_checklist_item. The buyer type sits in the header because the first
// rfq_received item asks for it. The list never blocks a stage move.
// =============================================================================

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Minus } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { StatusPill } from "@/components/phc/StatusPill";
import { Input } from "@/components/ui/input";
import { useI18n, formatNumber } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canCreateSalesRecords } from "@/lib/roles";
import { resolveCanonicalStage } from "@/lib/stage-canonical";
import { BUYER_TYPES, EMPTY_FACTS, evaluateChecklist, type BuyerType } from "@/lib/stage-checklist";
import { listChecklist, loadChecklistFacts, setBuyerType, setChecklistItem } from "@/lib/stage-checklist-actions";

type Opp = {
  id: string;
  stage: string | null;
  sales_stage: string | null;
  buyer_type?: string | null;
  company_id: string | null;
  expected_contract_date: string | null;
  contract_value: number | null;
  loss_reason: string | null;
};

const FIELD = "h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground";

export function StageChecklistPanel({ opportunity: o, stakeholders }: { opportunity: Opp; stakeholders: { role_code?: string | null }[] }) {
  const { t, lang } = useI18n();
  const { roles } = useAuth();
  const qc = useQueryClient();
  const canEdit = canCreateSalesRecords(roles);
  const stage = resolveCanonicalStage(o).stage;

  const rowsQ = useQuery({ queryKey: ["opp-checklist", o.id], queryFn: () => listChecklist(o.id) });
  const factsQ = useQuery({ queryKey: ["opp-checklist-facts", o.id, o.company_id], queryFn: () => loadChecklistFacts(o.id, o.company_id) });
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const items = useMemo(() => {
    const manual = Object.fromEntries((rowsQ.data ?? []).map((r) => [r.item_key, r.done]));
    return evaluateChecklist(stage, {
      ...EMPTY_FACTS,
      ...(factsQ.data ?? {}),
      buyer_type: o.buyer_type ?? null,
      roles: stakeholders.map((s) => s.role_code ?? "").filter(Boolean),
      expected_contract_date: o.expected_contract_date,
      contract_value: o.contract_value,
      loss_reason: o.loss_reason,
      manual,
    });
  }, [stage, rowsQ.data, factsQ.data, o, stakeholders]);

  const done = items.filter((i) => i.done).length;
  const noteOf = (key: string) => rowsQ.data?.find((r) => r.item_key === key)?.note ?? null;

  async function tick(key: string, value: boolean) {
    setBusy(key);
    try {
      await setChecklistItem(o.id, key, value, value ? note || noteOf(key) : null);
      setNoteFor(null); setNote("");
      await qc.invalidateQueries({ queryKey: ["opp-checklist", o.id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function changeBuyer(v: string) {
    try {
      await setBuyerType(o.id, (v || null) as BuyerType | null);
      await qc.invalidateQueries({ queryKey: ["opportunity", o.id] });
      toast.success(t("crm_saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Panel
      title={t("checklist_title")}
      subtitle={items.length ? `${formatNumber(done, lang)} / ${formatNumber(items.length, lang)}` : t("checklist_no_stage")}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="buyer-type" className="text-xs font-medium text-muted-foreground">{t("checklist_buyer_type")}</label>
        <select id="buyer-type" className={FIELD} value={o.buyer_type ?? ""} disabled={!canEdit} onChange={(e) => void changeBuyer(e.target.value)}>
          <option value="">{t("checklist_buyer_unset")}</option>
          {BUYER_TYPES.map((b) => <option key={b} value={b}>{t(`buyer_${b}` as never)}</option>)}
        </select>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("checklist_no_stage")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {items.map((it) => (
            <li key={it.key} className="rounded-md border border-border/60 px-3 py-2 text-sm">
              <div className="flex items-start gap-2.5">
                {it.kind === "auto" ? (
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm ${it.done ? "bg-won text-white" : "border border-border text-muted-foreground"}`} aria-hidden="true">
                    {it.done ? <Check className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-border accent-won"
                    checked={it.done}
                    disabled={!canEdit || busy === it.key}
                    aria-label={lang === "ar" ? it.ar : it.en}
                    onChange={(e) => (e.target.checked ? setNoteFor(it.key) : void tick(it.key, false))}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className={it.done ? "text-muted-foreground" : "text-foreground"}>{lang === "ar" ? it.ar : it.en}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StatusPill tone="muted">{it.kind === "auto" ? t("checklist_auto") : t("checklist_manual")}</StatusPill>
                    {it.kind === "manual" && noteOf(it.key) ? <span dir="auto" className="text-xs text-muted-foreground">{noteOf(it.key)}</span> : null}
                  </div>
                  {noteFor === it.key ? (
                    <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void tick(it.key, true); }}>
                      <Input dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("checklist_note")} maxLength={500} className="h-8" autoFocus />
                      <button type="submit" className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground" disabled={busy === it.key}>{t("checklist_done")}</button>
                      <button type="button" className="h-8 px-2 text-xs text-muted-foreground" onClick={() => { setNoteFor(null); setNote(""); }}>{t("cancel")}</button>
                    </form>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
