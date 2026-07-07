import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { Search, Loader2, Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/phc/SectionHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { searchKnowledge, reindexReferenceLibrary, type KnowledgeMatch } from "@/lib/rag-actions";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({ meta: [{ title: "Knowledge Search — PHC" }, { name: "robots", content: "noindex" }] }),
  component: KnowledgePage,
});

function KnowledgePage() {
  const { t } = useI18n();
  const { hasAnyRole } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeMatch[] | null>(null);
  const canReindex = hasAnyRole(["bd_manager", "sales_manager", "ceo"]);

  const search = useMutation({
    mutationFn: () => searchKnowledge(query),
    onSuccess: (m) => setResults(m),
    onError: (e) => toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")),
  });

  const reindex = useMutation({
    mutationFn: reindexReferenceLibrary,
    onSuccess: (r) => toast.success(`${t("knowledge_reindexed")}: ${r.indexed}`),
    onError: (e) => toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <SectionHeader
        title={t("knowledge_title")}
        hint={t("knowledge_hint")}
        action={
          canReindex ? (
            <button
              onClick={() => reindex.mutate()}
              disabled={reindex.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {reindex.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {t("knowledge_reindex")}
            </button>
          ) : null
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) search.mutate();
        }}
        className="mb-6 flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("knowledge_placeholder")}
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber/40"
        />
        <button
          type="submit"
          disabled={search.isPending || !query.trim()}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-4 py-2 text-sm text-amber-light hover:bg-amber/20 disabled:opacity-50"
        >
          {search.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {t("knowledge_search_btn")}
        </button>
      </form>

      {results === null ? (
        <EmptyState message={t("knowledge_empty_hint")} />
      ) : results.length === 0 ? (
        <EmptyState message={t("knowledge_no_results")} />
      ) : (
        <div className="space-y-3">
          {results.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-surface px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{r.title ?? "—"}</div>
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-3">{r.content}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusPill tone={r.similarity >= 0.8 ? "positive" : r.similarity >= 0.65 ? "neutral" : "muted"}>
                    {Math.round(r.similarity * 100)}% {t("knowledge_similarity")}
                  </StatusPill>
                  <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                    {r.source_type.replaceAll("_", " ")}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
