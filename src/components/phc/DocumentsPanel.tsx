// =============================================================================
// The Files section that lives inside a record — never on its own page.
//
// A standalone file manager was explicitly out of scope, and it would have been
// the wrong shape anyway: under Phase 6 a document's visibility comes from the
// records it is attached to, so a list of "all files" is a list whose contents
// change per viewer for reasons the page cannot explain. Files belong where
// their context is.
//
// Photos are not a separate system. A photo is a document whose MIME type is an
// image, so it lands in the same table, the same policy and the same panel —
// it just renders as a thumbnail instead of a row.
// =============================================================================

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Trash2, Upload, History, Link2Off } from "lucide-react";
import { Panel } from "@/components/phc/Panel";
import { EmptyState } from "@/components/phc/EmptyState";
import { AttachmentLink } from "@/components/phc/AttachmentLink";
import { AttachmentThumb } from "@/components/phc/AttachmentThumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { canRunSensitiveSalesAction } from "@/lib/roles";
import { listTeamMembers } from "@/lib/opportunity-actions";
import {
  buildVersionChain, deleteDocument, formatBytes, isPhoto, listEntityDocuments,
  unlinkDocument, updateDocumentMeta, uploadDocument, validateDocumentFile,
  type EntityDocument, type EntityRef,
} from "@/lib/document-actions";

export function DocumentsPanel({ entity, title }: { entity: EntityRef; title?: string }) {
  const { t, lang } = useI18n();
  const { user, roles } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [supersedeOf, setSupersedeOf] = useState<string | null>(null);
  const [showVersions, setShowVersions] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const key = ["documents", entity.type, entity.id];
  const { data: docs = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => listEntityDocuments(entity),
  });

  // One shared query for the whole page rather than a join per document — see
  // listEntityDocuments' comment on why no FK to profiles exists.
  const { data: team = [] } = useQuery({ queryKey: ["team-members-min"], queryFn: listTeamMembers });
  const nameOf = useMemo(() => {
    const m = new Map(team.map((p: { id: string; full_name: string | null; email: string | null }) =>
      [p.id, p.full_name ?? p.email]));
    return (id: string | null) => (id ? (m.get(id) ?? null) : null);
  }, [team]);

  const { photos, files } = useMemo(() => ({
    photos: docs.filter(isPhoto),
    files: docs.filter((d) => !isPhoto(d)),
  }), [docs]);

  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const upload = useMutation({
    mutationFn: async (file: File) =>
      uploadDocument({ entity, file, supersedes: supersedeOf }),
    onSuccess: () => { setSupersedeOf(null); refresh(); toast.success(t("doc_uploaded")); },
    onError: (e: Error) => toast.error(t(`doc_err_${e.message}` as never) || e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => { refresh(); toast.success(t("doc_deleted")); },
    onError: (e: Error) => toast.error(e.message),
  });

  const unlink = useMutation({
    mutationFn: (id: string) => unlinkDocument(id, entity),
    onSuccess: () => { refresh(); toast.success(t("doc_unlinked")); },
    onError: (e: Error) => toast.error(e.message),
  });

  const rename = useMutation({
    mutationFn: (v: { id: string; title: string }) => updateDocumentMeta(v.id, { title: v.title || null }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  // Deleting is the uploader's call, or a commercial manager's — the same set
  // the RLS policy's is_commercial_manager() admits. Showing a button the
  // database will refuse is worse than not showing it at all.
  const canRemove = (d: EntityDocument) =>
    d.uploaded_by === user?.id || canRunSensitiveSalesAction(roles);

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    const invalid = validateDocumentFile(f);
    if (invalid) { toast.error(t(`doc_err_${invalid}` as never) || invalid); return; }
    setBusy(true);
    try { await upload.mutateAsync(f); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-GB",
      { year: "numeric", month: "short", day: "numeric" });

  return (
    <Panel
      title={title ?? t("doc_files")}
      subtitle={docs.length ? t("doc_count").replace("{n}", String(docs.length)) : undefined}
      action={
        <div className="flex items-center gap-2">
          {supersedeOf ? (
            <span className="text-xs text-amber-light">{t("doc_replacing")}</span>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="me-1.5 h-3.5 w-3.5" />
            {busy ? t("doc_uploading") : t("doc_upload")}
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <p className="px-1 py-6 text-center text-xs text-muted-foreground">{t("loading")}</p>
      ) : docs.length === 0 ? (
        <EmptyState title={t("doc_none")} description={t("doc_none_hint")} />
      ) : (
        <div className="grid gap-4">
          {/* ---- Photos: same records, gallery rendering ---- */}
          {photos.length > 0 ? (
            <div>
              <p className="mb-2 text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                {t("doc_photos")} · {photos.length}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {photos.map((p) => (
                  <figure key={p.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                    <AttachmentThumb storagePath={p.storage_path} alt={p.title ?? p.original_filename} />
                    <figcaption className="space-y-0.5 px-2 py-1.5">
                      <AttachmentLink
                        storagePath={p.storage_path}
                        className="block truncate text-xs text-primary hover:underline"
                      >
                        {p.title ?? p.original_filename}
                      </AttachmentLink>
                      <span className="block text-2xs text-muted-foreground">
                        {formatBytes(p.size_bytes)} · {fmtDate(p.uploaded_at)}
                        {nameOf(p.uploaded_by) ? ` · ${nameOf(p.uploaded_by)}` : ""}
                      </span>
                      {p.captured_lat !== null ? (
                        <span className="block text-2xs text-muted-foreground">
                          {p.captured_lat}, {p.captured_lon}
                        </span>
                      ) : null}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}

          {/* ---- Everything else ---- */}
          {files.length > 0 ? (
            <div>
              {photos.length > 0 ? (
                <p className="mb-2 text-2xs uppercase tracking-[0.12em] text-muted-foreground">
                  {t("doc_documents")} · {files.length}
                </p>
              ) : null}
              <ul className="divide-y divide-border/70">
                {files.map((d) => {
                  const chain = showVersions === d.id ? buildVersionChain(docs, d.id) : [];
                  return (
                    <li key={d.id} className="py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <AttachmentLink
                            storagePath={d.storage_path}
                            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{d.title ?? d.original_filename}</span>
                          </AttachmentLink>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {d.mime_type ?? "—"} · {formatBytes(d.size_bytes)} · {fmtDate(d.uploaded_at)}
                            {nameOf(d.uploaded_by) ? ` · ${nameOf(d.uploaded_by)}` : ""}
                            {d.link_role ? ` · ${d.link_role}` : ""}
                          </p>
                          {d.superseded_by ? (
                            <p className="mt-0.5 text-xs text-amber-light">
                              {t("doc_superseded")}
                              {d.replaced_by_filename ? ` → ${d.replaced_by_filename}` : ""}
                            </p>
                          ) : null}
                          {d.notes ? (
                            <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{d.notes}</p>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            title={t("doc_versions")}
                            aria-label={t("doc_versions")}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowVersions(showVersions === d.id ? null : d.id)}
                          >
                            <History className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title={t("doc_supersede")}
                            aria-label={t("doc_supersede")}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                            onClick={() => { setSupersedeOf(d.id); fileRef.current?.click(); }}
                          >
                            <Upload className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title={t("doc_unlink")}
                            aria-label={t("doc_unlink")}
                            className="rounded p-1 text-muted-foreground hover:text-foreground"
                            onClick={() => unlink.mutate(d.id)}
                          >
                            <Link2Off className="h-3.5 w-3.5" />
                          </button>
                          {canRemove(d) ? (
                            <button
                              type="button"
                              title={t("doc_delete")}
                              aria-label={t("doc_delete")}
                              className="rounded p-1 text-muted-foreground hover:text-lost"
                              onClick={() => remove.mutate(d.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {/* Inline title editing — no dialog for a one-field change. */}
                      {showVersions === d.id ? (
                        <div className="mt-2 space-y-2 rounded-md border border-border/70 bg-surface-2 p-2">
                          <Input
                            className="h-7 text-xs"
                            defaultValue={d.title ?? ""}
                            placeholder={t("doc_title_placeholder")}
                            onBlur={(e) => {
                              if (e.target.value !== (d.title ?? "")) {
                                rename.mutate({ id: d.id, title: e.target.value });
                              }
                            }}
                          />
                          <ol className="space-y-1">
                            {chain.map((v, i) => (
                              <li key={v.id} className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground">v{i + 1}</span>
                                <AttachmentLink storagePath={v.storage_path} className="truncate text-primary hover:underline">
                                  {v.original_filename}
                                </AttachmentLink>
                                <span className="text-muted-foreground">{fmtDate(v.uploaded_at)}</span>
                                {v.id === d.id ? <span className="text-amber-light">{t("doc_this_one")}</span> : null}
                              </li>
                            ))}
                            {chain.length <= 1 ? (
                              <li className="text-xs text-muted-foreground">{t("doc_single_version")}</li>
                            ) : null}
                          </ol>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
