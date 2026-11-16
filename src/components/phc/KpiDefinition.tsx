import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";

/** The "how is this calculated" affordance KpiTile has, for hand-built cards. */
export function KpiDefinition({ label, definition, period }: { label: string; definition: string; period?: string }) {
  const { lang, dir } = useI18n();
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={lang === "ar" ? `كيف حُسب ${label}` : `How ${label} is calculated`}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
          >
            <Info className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side={dir === "rtl" ? "left" : "right"} className="max-w-[19rem] space-y-1.5 text-xs">
          <p className="font-medium text-foreground">{definition}</p>
          {period ? (
            <p className="text-muted-foreground">
              <span className="text-amber-light">{lang === "ar" ? "الفترة" : "Period"}:</span> {period}
            </p>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
