import { GitBranch, GitCommit, Github, CheckCircle2, AlertCircle } from "lucide-react";
import { StatusPill } from "./StatusPill";
import { useI18n } from "@/lib/i18n";

export function GitSyncStatus() {
  const { t, lang } = useI18n();

  const branch = (import.meta.env.VITE_GIT_BRANCH as string | undefined) || "unknown";
  const commitHash = (import.meta.env.VITE_GIT_COMMIT_HASH as string | undefined) || "unknown";
  const commitMessage = (import.meta.env.VITE_GIT_COMMIT_MESSAGE as string | undefined) || "";

  const isKnown = branch !== "unknown";

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md border border-border bg-background">
            <Github className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">{t("git_sync_title")}</div>
            <div className="text-xs text-muted-foreground">
              {isKnown
                ? lang === "ar"
                  ? "GitHub متصل عبر Lovable"
                  : "GitHub connected via Lovable"
                : lang === "ar"
                  ? "تعذّر قراءة معلومات Git"
                  : "Could not read Git info"}
            </div>
          </div>
        </div>

        <StatusPill tone={isKnown ? "positive" : "attention"}>
          {isKnown ? (
            <>
              <CheckCircle2 className="h-3 w-3" />
              <span>{t("git_status_connected")}</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-3 w-3" />
              <span>{t("git_status_unknown")}</span>
            </>
          )}
        </StatusPill>
      </div>

      <div className="mt-4 grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2">
        <div className="flex items-center gap-2.5 text-sm">
          <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{t("git_branch_label")}:</span>
          <code className="min-w-0 truncate rounded bg-background px-1.5 py-0.5 text-xs text-foreground">
            {branch}
          </code>
        </div>

        <div className="flex items-center gap-2.5 text-sm">
          <GitCommit className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">{t("git_commit_label")}:</span>
          <span className="min-w-0 truncate text-xs text-foreground" dir="ltr">
            <span className="rounded bg-background px-1.5 py-0.5 font-mono">{commitHash}</span>
            {commitMessage ? <span className="ms-2 text-muted-foreground">{commitMessage}</span> : null}
          </span>
        </div>
      </div>
    </div>
  );
}
