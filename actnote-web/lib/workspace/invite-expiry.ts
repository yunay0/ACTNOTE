/**
 * Email invite link validity for `create_invite` (`p_expires_in_days`).
 * Must stay within DB bounds (1..30) — see `migrations/016_workspace_invites.sql`.
 */
export const INVITE_EXPIRES_IN_DAYS = 7;
