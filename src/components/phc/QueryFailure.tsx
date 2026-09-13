import { EmptyState } from "./EmptyState";
import { useI18n } from "@/lib/i18n";

export function QueryFailure({ retry }: { retry: () => unknown }) {
  const { lang } = useI18n();
  return <EmptyState variant="error"
    title={lang === "ar" ? "تعذر تحميل البيانات" : "Could not load data"}
    description={lang === "ar" ? "أعد المحاولة لتحميل السجلات." : "Try again to load the records."}
    primaryAction={{ label: lang === "ar" ? "إعادة المحاولة" : "Try again", onClick: () => void retry() }}
  />;
}
