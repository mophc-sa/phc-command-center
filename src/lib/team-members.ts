/** Keep the full directory for historical attribution; filter only new choices. */
export function isAssignableTeamMember(member: { status?: string | null; is_display_account?: boolean | null }): boolean {
  return member.status === "active" && member.is_display_account !== true;
}
