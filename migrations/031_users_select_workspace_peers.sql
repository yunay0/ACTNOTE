-- 031: Allow workspace peers to read each other's public.users row (name, email).
--
-- Problem: RLS users_select_own only permits SELECT where id = auth.uid(), so
-- workspace_members JOIN users(...) returned null for other members → blank Team list.
--
-- Peer policy: same workspace_id membership as the current user.

BEGIN;

DROP POLICY IF EXISTS "users_select_workspace_peers" ON users;
CREATE POLICY "users_select_workspace_peers"
ON users FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM workspace_members wm_self
    INNER JOIN workspace_members wm_peer
      ON wm_peer.workspace_id = wm_self.workspace_id
     AND wm_peer.user_id = users.id
    WHERE wm_self.user_id = auth.uid()
  )
);

COMMIT;
