-- Clean databases do not necessarily inherit the hosted project's default
-- table grants. RLS alone does not grant SELECT: the notification bell was
-- returning HTTP 403 in the isolated browser suite. Allow reads explicitly;
-- existing recipient + active-session RLS still determines visible rows.
GRANT SELECT ON TABLE public.notifications TO authenticated;
