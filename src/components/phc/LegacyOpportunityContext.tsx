import { Panel } from "@/components/phc/Panel";
import { legacyOpportunityContext } from "@/lib/legacy-opportunity-context";

export function LegacyOpportunityContext({ extraData, ar }: { extraData: unknown; ar: boolean }) {
  const { canonical, sources } = legacyOpportunityContext(extraData);
  if (!canonical && sources.length === 0) return null;
  return (
    <Panel title={ar ? "سجل الاستيراد السابق" : "Legacy import context"}>
      {canonical ? (
        <p className="text-sm">
          {ar
            ? "هذه نسخة قديمة مؤرشفة بعد المطابقة. "
            : "This legacy copy was archived after reconciliation. "}
          <a className="text-primary underline" href={`/opportunities/${canonical}`}>
            {ar ? "فتح الفرصة الفعلية" : "Open the active opportunity"}
          </a>
        </p>
      ) : null}
      {sources.length ? (
        <ul className="space-y-3">
          {sources.map((source) => (
            <li key={source.id} className="text-sm space-y-1">
              <a className="text-primary underline" href={`/opportunities/${source.id}`}>
                {ar ? "السجل الأصلي" : "Original record"}
                {source.salesCode ? ` · ${source.salesCode}` : ""}
              </a>
              {source.subject ? <p>{source.subject}</p> : null}
              {source.note ? (
                <p className="whitespace-pre-wrap text-muted-foreground">{source.note}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
