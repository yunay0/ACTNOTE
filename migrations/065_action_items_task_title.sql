-- Owner-edited Notion task title (optional; falls back to derive from content).
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS task_title TEXT;

COMMENT ON COLUMN action_items.task_title IS
  'User override for Notion Task title / UI. NULL → derive from content at publish.';
