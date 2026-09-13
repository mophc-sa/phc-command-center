import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useSupabaseAuth";
import { useI18n } from "@/lib/i18n";
import { parseOpportunitySearch, type OpportunitySearch } from "@/lib/drilldown";

type SavedView = { name: string; search: OpportunitySearch };

/** Personal views store filters only, scoped to the signed-in user. */
export function SavedOpportunityViews({ search, onSelect }: {
  search: OpportunitySearch;
  onSelect: (search: OpportunitySearch) => void;
}) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const ar = lang === "ar";
  const [name, setName] = useState("");
  const [views, setViews] = useState<SavedView[]>([]);
  const [error, setError] = useState(false);
  const key = user ? `phc:opportunity-views:${user.id}` : null;
  useEffect(() => {
    try {
      const raw: unknown = key ? JSON.parse(localStorage.getItem(key) ?? "[]") : [];
      setViews(Array.isArray(raw) ? raw.filter(v => typeof v?.name === "string" && v.search && typeof v.search === "object").slice(0, 20).map(v => ({ name: v.name, search: parseOpportunitySearch(v.search) })) : []);
    } catch { setViews([]); }
  }, [key]);
  function persist(next: SavedView[]) {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(next)); setViews(next); setError(false); setName(""); }
    catch { setError(true); }
  }
  return <details className="mb-4 rounded-lg border border-border p-3">
    <summary className="cursor-pointer text-sm font-medium">{ar ? "مشاهدي المحفوظة" : "My saved views"}</summary>
    <p className="my-2 text-xs text-muted-foreground">{ar ? "تُحفظ المرشحات لهذا الحساب على هذا المتصفح." : "Filters are saved for your account in this browser."}</p>
    <div className="flex flex-wrap gap-2">
      {views.map(v => <div key={v.name} className="flex rounded-md border">
        <button type="button" className="min-h-11 px-3 text-sm" onClick={() => onSelect(v.search)}>{v.name}</button>
        <button type="button" aria-label={`${ar ? "حذف المشهد" : "Delete view"} ${v.name}`} className="min-h-11 min-w-11 border-s" onClick={() => persist(views.filter(x => x.name !== v.name))}>×</button>
      </div>)}
    </div>
    <form className="mt-3 flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); if (name.trim()) persist([...views.filter(v => v.name !== name.trim()), { name: name.trim(), search }].slice(-20)); }}>
      <label className="sr-only" htmlFor="view-name">{ar ? "اسم المشهد" : "View name"}</label>
      <input id="view-name" value={name} maxLength={60} onChange={e => setName(e.target.value)} placeholder={ar ? "اسم المشهد" : "View name"} className="min-h-11 rounded-md border bg-background px-3 text-sm" />
      <button type="submit" disabled={!key || !name.trim()} className="min-h-11 rounded-md border px-3 text-sm disabled:opacity-50">{ar ? "حفظ المرشحات الحالية" : "Save current filters"}</button>
    </form>
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{ar ? "تعذر الحفظ في هذا المتصفح." : "This browser could not save the view."}</p> : null}
  </details>;
}
