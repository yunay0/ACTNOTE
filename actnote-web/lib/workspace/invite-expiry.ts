/**
 * Email invite link validity for `create_invite` (must stay within DB max — see migrations/028).
 * Keep mail copy and RPC argument in sync.
 */
export const INVITE_EXPIRES_IN_DAYS = 90;
