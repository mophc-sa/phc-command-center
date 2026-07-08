import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { Search, Loader2, Sparkles, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/phc/PageHeader";
import { EmptyState } from "@/components/phc/EmptyState";
import { StatusPill } from "@/components/phc/StatusPill";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { searchKnowledge, reindexReferenceLibrary, type KnowledgeMatch } from "@/lib/rag-actions";
import { canManageSalesPipeline } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({ meta: [{ title: "Knowledge Search — PHC" }, { name: "robots", content: "noindex" }] }),
  component: KnowledgePage,
});

function confidenceLabel(sim: number): { tone: "positive" | "neutral" | "muted"; label: string } {
  if (sim >= 0.8) return { tone: "positive", label: "High relevance" };
  if (sim >= 0.65) return { tone: "neutral", label: "Moderate relevance" };
  return { tone: "muted", label: "Low relevance" };
}

function KnowledgePage() {
  const { t } = useI18n();
  const { roles } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeMatch[] | null>(null);
  const [lastQuery, setLastQuery] = useState("");
  const canReindex = canManageSalesPipeline(roles);

  const search = useMutation({
    mutationFn: () => searchKnowledge(query),
    onSuccess: (m) => { setResults(m); setLastQuery(query); },
    onError: (e) => toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")),
  });

  const reindex = useMutation({
    mutationFn: reindexReferenceLibrary,
    onSuccess: (r) => toast.success(`${t("knowledge_reindexed")}: ${r.indexed}`),
    onError: (e) => toast.error(t("toast_error") + (e instanceof Error ? `: ${e.message}` : "")),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={t("navgroup_intelligence")}
        title={t("knowledge_title")}
        description={t("knowledge_hint")}
        actions={
          canReindex ? (
            <button
              onClick={() => reindex.mutate()}
              disabled={reindex.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {reindex.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {t("knowledge_reindex")}
            </button>
          ) : null
        }
      />

      <div className="rounded-xl border border-border/70 bg-surface/60 p-5">
        <form
          onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("knowledge_placeholder")}
              className="w-full rounded-md border border-border bg-background ps-10 pe-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-amber/40"
            />
          </div>
          <button
            type="submit"
            disabled={search.isPending || !query.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-amber/40 bg-amber/10 px-5 py-2.5 text-sm font-medium text-amber-light hover:bg-amber/20 disabled:opacity-50"
          >
            {search.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t("knowledge_search_btn")}
          </button>
        </form>
        <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3" />
          Retrieved from your internal reference library. Always verify with the source document.
        </div>
      </div>

      {results !== null && lastQuery ? (
        <div className="mt-6 mb-3 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {results.length} {results.length === 1 ? "result" : "results"} for <span className="text-foreground">"{lastQuery}"</span>
          </div>
        </div>
      ) : null}

      <div className="mt-6">
        {results === null ? (
          <EmptyState message={t("knowledge_empty_hint")} hint="Search returns evidence with a relevance score. Sources remain inspectable." />
        ) : results.length === 0 ? (
          <EmptyState message={t("knowledge_no_results")} hint="Try broader or different keywords." />
        ) : (
          <div className="space-y-3">
            {results.map((r) => {
              const c = confidenceLabel(r.similarity);
              return (
                <div key={r.id} className="rounded-xl border border-border/70 bg-surface/60 px-4 py-4 transition-colors hover:border-border-strong/70 hover:bg-surface">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">{r.title ?? "—"}</div>
                      <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground line-clamp-4">{r.content}</div>
                      <div className="mt-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                        <span>{r.source_type.replaceAll("_", " ")}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <StatusPill tone={c.tone}>{Math.round(r.similarity * 100)}%</StatusPill>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{c.label}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
