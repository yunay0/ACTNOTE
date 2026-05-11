# Meeting soft delete policy

## Definition

- **Soft delete** sets `meetings.deleted_at` (and `updated_at`) to the current timestamp. The row remains in the database.
- **Hard delete** (physical `DELETE` from `meetings`) is not exposed in the product UI for MVP. Reserved for background retention or admin operations using `service_role`.

## Who can delete

- Any user who is a **member of the meeting’s workspace** may perform soft delete, subject to RLS.
- Initial schema policy `meetings_update` (`migrations/001_initial_schema.sql`) allows `UPDATE` when `workspace_id` is in the caller’s `workspace_members` rows. That includes setting `deleted_at`.
- There is **no owner-only** restriction on soft delete in the current schema; product copy may still describe deletion as a serious action.

## Visibility after delete

- **RLS (`meetings_select`)**: After migration **`019_meetings_select_soft_delete_rls.sql`**, members may **SELECT** any meeting row in their workspace, including rows with `deleted_at` set. That is required so `UPDATE … RETURNING` (Supabase `.update().select()`) succeeds when soft-deleting.
- **List and search**: Queries MUST still filter `deleted_at IS NULL` (e.g. home list in `useMeetings`, meeting RPC/search paths).
- **Detail page**: Keep fetching with `.is("deleted_at", null)` so a soft-deleted meeting behaves like **not found** in the app even though RLS would allow reading it by id.

## Pipeline and worker

- If a meeting is soft-deleted while a pipeline run is in progress, the worker may still complete using `service_role`. Product expectation: the meeting disappears from the UI; any late writes should target the same `meeting_id` (no automatic cancel is required for MVP). A future policy could abort runs when `deleted_at` is set.

## UI behavior

- **Home**: Card menu Delete calls shared helper `softDeleteMeetingRow`; only remove the card from local state after a confirmed successful update; show an inline error if the update fails.
- **Detail**: Confirm modal → same helper; on success navigate to `/meetings`; on failure show error inside the modal.

## Future: purge

- Optional **retention job** may hard-delete or archive rows where `deleted_at` is older than N days. Not implemented in MVP; coordinate with A before adding migrations or jobs.
