import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useSupabaseAuth";

export type NotifKind = "flag" | "approval";

export type Notification = {
  id: string;
  kind: NotifKind;
  title: string;
  subtitle: string | null;
  tone: "danger" | "attention";
  opportunityId: string | null;
  createdAt: string;
  dueDate: string | null;
};

const ACTIVE_FLAG_STATUSES = ["open", "in_progress", "escalated", "blocked"] as const;

export function useNotifications() {
  const { user } = useAuth();
  const uid = user?.id ?? "";

  return useQuery({
    queryKey: ["notifications", uid],
    enabled: !!uid,
    staleTime: 60_000,
    queryFn: async (): Promise<Notification[]> => {
      const [flagsRes, approvalsRes] = await Promise.all([
        supabase
          .from("opportunity_flags")
          .select("id, flag_kind, reason, action_type, risk_flag, priority, linked_record_id, linked_record_type, due_date, created_at, status")
          .eq("action_owner_id", uid)
          .in("status", ACTIVE_FLAG_STATUSES)
          .order("created_at", { ascending: false })
          .limit(30),

        supabase
          .from("approvals")
          .select("id, approval_type, related_opportunity_id, created_at, status, assigned_approver, requested_by")
          .eq("status", "pending")
          .or(`assigned_approver.eq.${uid},requested_by.eq.${uid}`)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      const flags: Notification[] = (flagsRes.data ?? []).map((f) => ({
        id: `flag-${f.id}`,
        kind: "flag" as const,
        title: f.reason ?? humanize(f.action_type ?? f.risk_flag ?? f.flag_kind),
        subtitle: f.linked_record_type === "opportunity" ? `Opportunity · ${f.priority ?? "—"}` : null,
        tone: (f.flag_kind === "risk" ? "danger" : "attention") as "danger" | "attention",
        opportunityId: f.linked_record_type === "opportunity" ? f.linked_record_id : null,
        createdAt: f.created_at,
        dueDate: f.due_date,
      }));

      const approvals: Notification[] = (approvalsRes.data ?? []).map((a) => ({
        id: `approval-${a.id}`,
        kind: "approval" as const,
        title: humanize(a.approval_type),
        subtitle: a.assigned_approver === uid ? "Awaiting your decision" : "Submitted by you",
        tone: "attention" as const,
        opportunityId: a.related_opportunity_id,
        createdAt: a.created_at,
        dueDate: null,
      }));

      return [...flags, ...approvals].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
  });
}

function humanize(s: string | null | undefined): string {
  if (!s) return "Action required";
  return s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
