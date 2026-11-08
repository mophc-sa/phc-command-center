import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Panel } from "@/components/phc/Panel";
import { SkeletonTable } from "@/components/phc/Skeleton";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { StatusPill } from "@/components/phc/StatusPill";
import { ActionDialog } from "@/components/phc/ActionDialog";
import { useI18n, formatNumber } from "@/lib/i18n";
import { addExtra, decideExtra, listCatalog, listFileExtras, suggestExtras, type FileExtraRow } from "@/lib/pricing-actions";
import { canEditLineCost, canSuggestExtras } from "@/lib/pricing-access";
import { parseDraft } from "@/lib/pricing-input";
import { asError, dbMessage, draftError, pick, type Bi } from "@/lib/pricing-text";
import { suggestRunKey, type PricingTabProps } from "@/components/phc/pricing/types";

const TEXT = {
  title: { en: "Extras", ar: "البنود الإضافية" },
  sub: { en: "Every suggested item must be accepted or dismissed before the price can be proposed. Extras belong to the current BOQ round.", ar: "كل بند مقترح يجب قبوله أو رفضه قبل اقتراح السعر. البنود الإضافية خاصة بجولة الكميات الحالية." },
  check: { en: "Check suggestions", ar: "افحص الاقتراحات" },
  added: { en: "new suggestions", ar: "اقتراحات جديدة" },
  item: { en: "Item", ar: "البند" },
  qty: { en: "Qty", ar: "الكمية" },
  rate: { en: "Rate", ar: "السعر" },
  status: { en: "Status", ar: "الحالة" },
  suggested: { en: "Suggested", ar: "مقترح" },
  accepted: { en: "Accepted", ar: "مقبول" },
  dismissed: { en: "Dismissed", ar: "مرفوض" },
  accept: { en: "Accept", ar: "اقبل" },
  dismiss: { en: "Dismiss", ar: "ارفض" },
  dismissTitle: { en: "Dismiss this item", ar: "رفض هذا البند" },
  reason: { en: "Why is it not needed?", ar: "لماذا لا حاجة له؟" },
  add: { en: "Add from the catalog", ar: "أضف من الكتالوج" },
  pickItem: { en: "Choose an item", ar: "اختر بنداً" },
  addBtn: { en: "Add", ar: "أضف" },
  none: { en: "No extras for this round yet.", ar: "لا بنود إضافية لهذه الجولة بعد." },
  saved: { en: "Saved", ar: "تم الحفظ" },
} satisfies Record<string, Bi>;

const FIELD =
  "w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

export function ExtrasPanel({ file, rights, onChanged }: PricingTabProps) {
  const { lang } = useI18n();
  const qc = useQueryClient();
  const revisionId = file.boq_revision_id;
  const costOk = rights.can_read_cost;
  const extras = useQuery({
    queryKey: ["pricing-extras", file.file_id, revisionId],
    queryFn: () => listFileExtras(file.file_id, revisionId as string),
    enabled: revisionId != null && costOk,
  });
  const catalog = useQuery({ queryKey: ["pricing-catalog"], queryFn: listCatalog, enabled: costOk });
  const editable = canEditLineCost(file.state, rights);
  const canCheck = canSuggestExtras(file.state, rights);
  const [edits, setEdits] = useState<Record<string, { quantity?: string; rate?: string }>>({});
  const [dismissing, setDismissing] = useState<FileExtraRow | null>(null);
  const [add, setAdd] = useState({ id: "", quantity: "1", rate: "" });
  const [busy, setBusy] = useState(false);
  const name = (x: FileExtraRow) => (x.catalog ? (lang === "ar" ? x.catalog.name_ar : x.catalog.name_en) : "—");

  if (!costOk || revisionId == null) return null;
  if (extras.isLoading) return <SkeletonTable rows={3} />;
  if (extras.isError) return <QueryFailure retry={() => void extras.refetch()} />;

  async function run(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast.success(pick(TEXT.saved, lang));
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (busy) return;
    setBusy(true);
    try {
      const n = await suggestExtras(file.file_id);
      // A successful check is also the on-open check: it clears a failed one, and the open count is stale now.
      qc.setQueryData(suggestRunKey(file.file_id, revisionId), n);
      void qc.invalidateQueries({ queryKey: ["pricing-open-suggestions", file.file_id] });
      toast.success(`${n} ${pick(TEXT.added, lang)}`);
      onChanged();
    } catch (e) {
      toast.error(dbMessage(e, lang));
    } finally {
      setBusy(false);
    }
  }

  // Quantity and rate stay text while typed; they become numbers here, with the import's comma rules.
  const parsed = (s: string | undefined): { ok: true; value?: number } | { ok: false; message: string } => {
    const rules = { min: 0 };
    const r = parseDraft(s ?? "", rules);
    return r.ok ? { ok: true, value: r.value ?? undefined } : { ok: false, message: draftError(r.reason, lang, rules) };
  };
  const addQty = parsed(add.quantity);
  const rows = extras.data ?? [];

  return (
    <Panel title={pick(TEXT.title, lang)} subtitle={pick(TEXT.sub, lang)}
      action={canCheck ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void check()}>{pick(TEXT.check, lang)}</Button> : undefined}>
      <div className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{pick(TEXT.none, lang)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pick(TEXT.item, lang)}</TableHead>
                <TableHead className="text-end">{pick(TEXT.qty, lang)}</TableHead>
                <TableHead className="text-end">{pick(TEXT.rate, lang)}</TableHead>
                <TableHead>{pick(TEXT.status, lang)}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((x) => {
                const open = x.status === "suggested" && editable;
                const e = edits[x.id] ?? {};
                return (
                  <TableRow key={x.id}>
                    <TableCell>{name(x)}{x.catalog ? <span className="text-xs text-muted-foreground"> · {x.catalog.unit}</span> : null}</TableCell>
                    <TableCell className="text-end">
                      {open ? (
                        <input type="text" inputMode="decimal" className={`${FIELD} w-24`} aria-label={`${pick(TEXT.qty, lang)}: ${name(x)}`}
                          value={e.quantity ?? String(x.quantity)} disabled={busy}
                          onChange={(ev) => setEdits((m) => ({ ...m, [x.id]: { ...m[x.id], quantity: ev.target.value } }))} />
                      ) : (
                        <span className="tabular-nums">{formatNumber(x.quantity, lang)}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      {open ? (
                        <input type="text" inputMode="decimal" className={`${FIELD} w-28`} aria-label={`${pick(TEXT.rate, lang)}: ${name(x)}`}
                          value={e.rate ?? String(x.rate)} disabled={busy}
                          onChange={(ev) => setEdits((m) => ({ ...m, [x.id]: { ...m[x.id], rate: ev.target.value } }))} />
                      ) : (
                        <span className="tabular-nums">{formatNumber(x.rate, lang)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={x.status === "suggested" ? "attention" : x.status === "accepted" ? "positive" : "muted"}>
                        {pick(TEXT[x.status], lang)}
                      </StatusPill>
                      {x.dismiss_reason ? <div className="text-xs text-muted-foreground">{x.dismiss_reason}</div> : null}
                    </TableCell>
                    <TableCell className="text-end">
                      {open ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" disabled={busy} onClick={() => {
                            const q = parsed(e.quantity), rt = parsed(e.rate);
                            if (!q.ok) return void toast.error(q.message);
                            if (!rt.ok) return void toast.error(rt.message);
                            void run(() => decideExtra(x.id, true, { quantity: q.value, rate: rt.value }));
                          }}>
                            {pick(TEXT.accept, lang)}
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => setDismissing(x)}>{pick(TEXT.dismiss, lang)}</Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {editable ? (
          <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <label className="space-y-1 text-sm">
              <span>{pick(TEXT.add, lang)}</span>
              <select className={FIELD} disabled={busy} value={add.id} onChange={(e) => setAdd((a) => ({ ...a, id: e.target.value }))}>
                <option value="">{pick(TEXT.pickItem, lang)}</option>
                {(catalog.data ?? []).filter((c) => c.active).map((c) => (
                  <option key={c.id} value={c.id}>{lang === "ar" ? c.name_ar : c.name_en} · {c.unit}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>{pick(TEXT.qty, lang)}</span>
              <input type="text" inputMode="decimal" className={FIELD} disabled={busy} value={add.quantity} onChange={(e) => setAdd((a) => ({ ...a, quantity: e.target.value }))} />
            </label>
            <label className="space-y-1 text-sm">
              <span>{pick(TEXT.rate, lang)}</span>
              <input type="text" inputMode="decimal" className={FIELD} disabled={busy} value={add.rate}
                placeholder={String((catalog.data ?? []).find((c) => c.id === add.id)?.default_rate ?? "")}
                onChange={(e) => setAdd((a) => ({ ...a, rate: e.target.value }))} />
            </label>
            <Button disabled={busy || !add.id || !(addQty.ok && (addQty.value ?? 0) > 0)}
              onClick={() => {
                const rt = parsed(add.rate);
                if (!rt.ok) return void toast.error(rt.message);
                void run(async () => {
                  await addExtra(file.file_id, add.id, addQty.ok ? (addQty.value ?? 0) : 0, rt.value ?? null);
                  setAdd({ id: "", quantity: "1", rate: "" });
                });
              }}>
              {pick(TEXT.addBtn, lang)}
            </Button>
          </div>
        ) : null}
      </div>

      {/* recordId stays next to open: action-dialog-drafts.contract.test.ts reads the first 300 characters. */}
      <ActionDialog
        open={!!dismissing}
        recordId={dismissing?.id ?? null}
        onOpenChange={(o) => !o && setDismissing(null)}
        title={pick(TEXT.dismissTitle, lang)}
        description={dismissing ? name(dismissing) : undefined}
        fields={[{ key: "reason", type: "textarea", label: pick(TEXT.reason, lang), required: true }]}
        submitLabel={pick(TEXT.dismiss, lang)}
        onSubmit={async (v) => {
          if (!dismissing) return;
          try {
            await decideExtra(dismissing.id, false, { reason: v.reason });
            onChanged();
          } catch (e) {
            throw asError(e, lang);
          }
        }}
      />
    </Panel>
  );
}
