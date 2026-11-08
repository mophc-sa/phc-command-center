/** Keep the full directory for historical attribution; filter only new choices. Supplier accounts (vendor_id set) are never staff. */
export function isAssignableTeamMember(member: {
  status?: string | null;
  is_display_account?: boolean | null;
  vendor_id?: string | null;
}): boolean {
  return member.status === "active" && member.is_display_account !== true && !member.vendor_id;
}
