// Image 26 (Omar's CRM review): who can do what — each person, their roles,
// how many open records they own, and whether they can approve commercially.
// Read-only here; roles are changed in Admin settings.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { QueryFailure } from "@/components/phc/QueryFailure";
import { listTeamMembers } from "@/lib/opportunity-actions";
import { fetchAllRows } from "@/lib/fetch-all";
import { canApproveCommercialAction, type AppRole } from "@/lib/roles";
import { useI18n, formatNumber } from "@/lib/i18n";

export function AccessPanel() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const q = useQuery({
    queryKey: ["settings-access"],
    queryFn: async () => {
      const [team, roles, opps] = await Promise.all([
        listTeamMembers(),
        supabase.from("user_roles").select("user_id, role"),
        fetchAllRows(() => supabase.from("opportunities").select("id, owner_id").neq("stage", "archived").not("sales_stage", "in", "(won,lost)").order("id")),
      ]);
      if (roles.error) throw roles.error;
      const byUser = new Map<string, AppRole[]>();
      for (const r of roles.data ?? []) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role as AppRole]);
      const owned = new Map<string, number>();
      for (const o of opps.rows as { owner_id: string | null }[]) if (o.owner_id) owned.set(o.owner_id, (owned.get(o.owner_id) ?? 0) + 1);
      return (team as any[]).map((m) => ({ id: m.id as string, name: (m.full_name || m.email || "—") as string, roles: byUser.get(m.id) ?? [], owned: owned.get(m.id) ?? 0 }));
    },
  });
  return (
    <section className="rounded-xl border border-border/70 bg-surface/60">
      <header className="border-b border-border/60 px-5 py-4">
        <div className="text-base font-semibold text-foreground">{ar ? "الصلاحيات" : "Access"}</div>
        <div className="text-sm text-muted-foreground">{ar ? "الأدوار تُعدَّل من إعدادات الإدارة." : "Roles are changed in Admin settings."}</div>
      </header>
      {q.error ? <QueryFailure retry={() => void q.refetch()} /> : !q.data ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{ar ? "جارٍ التحميل…" : "Loading…"}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{ar ? "المستخدم" : "User"}</TableHead>
              <TableHead>{ar ? "الدور" : "Role"}</TableHead>
              <TableHead>{ar ? "السجلات المسندة" : "Assigned records"}</TableHead>
              <TableHead>{ar ? "الاعتماد التجاري" : "Commercial approval"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-semibold">{u.name}</TableCell>
                <TableCell className="text-sm">{u.roles.map((r) => r.replace(/_/g, " ")).join(", ") || "—"}</TableCell>
                <TableCell className="tabular-nums">{formatNumber(u.owned, lang)}</TableCell>
                <TableCell>{canApproveCommercialAction(u.roles) ? (ar ? "نعم" : "Yes") : (ar ? "لا" : "No")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
