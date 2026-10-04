-- =============================================================================
-- Meetings are read by the people who were in them, not only by reviewers.
--
-- v1 (20261001100000) let only pipeline operators and system admins read
-- meetings; attendee-level reading was deferred because Fireflies' speaker
-- labels ("Speaker 3") do not map reliably to accounts. The user chose
-- (2026-10-04, option A) to let each person read the meetings they attended,
-- matched by what IS reliable:
--   * their sign-in email (auth.users) is the organizer or in the participant
--     list Fireflies sends (calendar invitees), or
--   * a reviewer approved one of the meeting's action items into a task they
--     own (a pre-filled guess does not count until approved).
-- Read only. Approving and dismissing stay with can_review_meetings.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_read_meeting(_meeting_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_review_meetings(_user_id)
    OR EXISTS (
      SELECT 1
        FROM public.meetings m
        JOIN auth.users u ON u.id = _user_id AND u.email IS NOT NULL
       WHERE m.id = _meeting_id
         AND (lower(m.organizer_email) = lower(u.email)
              -- Fireflies sometimes sends several addresses in one entry.
              OR lower(u.email) = ANY (SELECT lower(btrim(x)) FROM unnest(m.participants) p,
                                              unnest(string_to_array(p, ',')) x))
    )
    OR EXISTS (
      SELECT 1 FROM public.meeting_action_items i
       WHERE i.meeting_id = _meeting_id AND i.status = 'approved' AND i.owner_id = _user_id
    );
$$;
REVOKE ALL ON FUNCTION public.can_read_meeting(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_meeting(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Meetings readable by reviewers" ON public.meetings;
DROP POLICY IF EXISTS "Meetings readable by reviewers and attendees" ON public.meetings;
CREATE POLICY "Meetings readable by reviewers and attendees" ON public.meetings
  FOR SELECT TO authenticated USING (public.can_read_meeting(id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Meeting action items readable by reviewers" ON public.meeting_action_items;
DROP POLICY IF EXISTS "Meeting action items readable by meeting readers" ON public.meeting_action_items;
CREATE POLICY "Meeting action items readable by meeting readers" ON public.meeting_action_items
  FOR SELECT TO authenticated USING (public.can_read_meeting(meeting_id, (SELECT auth.uid())));

COMMENT ON TABLE public.meetings IS
  'Meetings processed by Fireflies.ai. Written only by ingest_meeting (service role, from meetings-inbound); read by reviewers (can_review_meetings) and by attendees (can_read_meeting).';
