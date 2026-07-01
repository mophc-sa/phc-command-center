export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-start justify-center rounded-lg border border-dashed border-border bg-surface/40 px-5 py-8">
      <div className="text-sm text-foreground">{message}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
