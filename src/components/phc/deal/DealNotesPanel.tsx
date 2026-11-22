// Review 81/82 item 2 (Omar, 2026-11-22): technical and commercial notes, each
// entry with its writer and time inside the box, shaped like Discussion. Who
// sees which is enforced by RLS (public.can_read_note_kind); the panel is only
// rendered for roles that pass the same check.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/phc/Panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteDiscussionPost, listDiscussion, postDiscussionUpdate, type NoteKind } from "@/lib/opportunity-collab-actions";
import { localeFor, type Lang } from "@/lib/i18n";

export function DealNotesPanel({ opportunityId, kind, lang, userId }: {
  opportunityId: string; kind: Exclude<NoteKind, "discussion">; lang: Lang; userId: string | null;
}) {
  const ar = lang === "ar";
  const qc = useQueryClient();
  const key = ["opp-notes", opportunityId, kind];
  const q = useQuery({ queryKey: key, queryFn: () => listDiscussion(opportunityId, kind) });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const title = kind === "technical" ? (ar ? "ملاحظات فنية" : "Technical notes") : (ar ? "ملاحظات تجارية" : "Commercial notes");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={title}>
      <div className="grid gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Textarea aria-label={title} rows={2} value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder={ar ? "اكتب ملاحظة…" : "Write a note…"} className="flex-1" />
          <Button type="button" disabled={busy || !draft.trim()}
            onClick={() => void run(async () => { await postDiscussionUpdate({ opportunityId, body: draft.trim(), kind }); setDraft(""); })}>
            {ar ? "إضافة" : "Add"}
          </Button>
        </div>
        {(q.data ?? []).length ? (
          <ul className="grid gap-2">
            {(q.data ?? []).map((n) => (
              <li key={n.id} className="rounded-lg border border-border bg-surface-2 p-3">
                <p className="whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{n.author?.full_name ?? n.author?.email ?? "—"}</span>
                  <span aria-hidden="true">·</span>
                  <span>{new Date(n.created_at).toLocaleString(localeFor(lang), { dateStyle: "medium", timeStyle: "short" })}</span>
                  {n.created_by === userId ? (
                    <button type="button" aria-label={ar ? "حذف" : "Delete"} disabled={busy}
                      onClick={() => void run(() => deleteDiscussionPost(n.id))}
                      className="ms-auto rounded p-1 hover:text-destructive"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{q.isLoading ? (ar ? "جارٍ التحميل…" : "Loading…") : (ar ? "لا ملاحظات بعد." : "No notes yet.")}</p>
        )}
      </div>
    </Panel>
  );
}
