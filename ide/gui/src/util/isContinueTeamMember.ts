/**
 * Utility to check if a user belongs to the TNT project domain.
 */
export function isTntTeamMember(email?: string): boolean {
  if (!email) return false;
  return email.includes("@tnt.dev");
}
