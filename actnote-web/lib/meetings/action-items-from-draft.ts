/**
 * meetings.ai_draft_notes(JSON) 에서 action_items 복원 — DB row 없을 때 Draft UI 폴백.
 */

export type DraftNoteActionRow = {
  content: string;
  task_title?: string | null;
  assignee: string | null;
  assignee_user_id: string | null;
  due_date: string | null;
  confidence: number | null;
};

export const DRAFT_NOTE_ACTION_ID_PREFIX = "draft-note:";

export function isDraftNoteActionId(id: string): boolean {
  return id.startsWith(DRAFT_NOTE_ACTION_ID_PREFIX);
}

function normalizeDueYmd(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** ai_draft_notes / extracted JSON → 액션 행 목록 */
export function parseActionItemsFromDraftNotes(
  draftNotes: Record<string, unknown> | null | undefined,
): DraftNoteActionRow[] {
  if (!draftNotes || typeof draftNotes !== "object") return [];
  const raw = draftNotes.action_items;
  if (!Array.isArray(raw)) return [];

  const out: DraftNoteActionRow[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const content = String(o.content ?? "").trim();
    if (!content) continue;
    const confRaw = o.confidence;
    const confidence =
      typeof confRaw === "number" && !Number.isNaN(confRaw) ? confRaw : null;
    const taskTitleRaw = o.task_title;
    const task_title =
      taskTitleRaw != null && String(taskTitleRaw).trim() ? String(taskTitleRaw).trim() : null;
    out.push({
      content,
      task_title,
      assignee: o.assignee != null && String(o.assignee).trim() ? String(o.assignee).trim() : null,
      assignee_user_id:
        o.assignee_user_id != null && String(o.assignee_user_id).trim()
          ? String(o.assignee_user_id).trim()
          : null,
      due_date: normalizeDueYmd(o.due_date),
      confidence,
    });
  }
  return out;
}

/** UI용 임시 id (DB insert 전) */
export type SyncedActionItemRow = {
  id: string;
  content: string;
  task_title: string | null;
  assignee: string | null;
  assignee_user_id: string | null;
  due_date: string | null;
  confidence: number | null;
  status: "open" | "done" | "cancelled";
};

/** DB에 액션이 없을 때 ai_draft_notes → action_items INSERT (RLS: owner) */
export async function syncActionItemsFromDraftNotes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  meetingId: string,
  workspaceId: string,
  rows: DraftNoteActionRow[],
): Promise<SyncedActionItemRow[]> {
  if (!meetingId || !workspaceId || rows.length === 0) return [];

  const inserted: SyncedActionItemRow[] = [];
  for (const row of rows) {
    const payload = {
      meeting_id: meetingId,
      workspace_id: workspaceId,
      content: row.content,
      task_title: row.task_title?.trim() || null,
      assignee: row.assignee,
      assignee_user_id: row.assignee_user_id,
      due_date: row.due_date,
      confidence: row.confidence,
      change_type: "ADD" as const,
      status: "open" as const,
    };
    const { data, error } = await supabase
      .from("action_items")
      .insert(payload)
      .select("id, content, task_title, assignee, assignee_user_id, due_date, confidence, status")
      .single();

    if (error) {
      console.warn("[syncActionItemsFromDraftNotes] insert failed:", error.message);
      continue;
    }
    const d = data as Record<string, unknown>;
    inserted.push({
      id: String(d.id),
      content: String(d.content ?? row.content),
      task_title:
        d.task_title != null && String(d.task_title).trim()
          ? String(d.task_title).trim()
          : row.task_title ?? null,
      assignee: d.assignee != null ? String(d.assignee) : row.assignee,
      assignee_user_id:
        d.assignee_user_id != null ? String(d.assignee_user_id) : row.assignee_user_id,
      due_date:
        d.due_date != null ? String(d.due_date).slice(0, 10) : row.due_date,
      confidence: typeof d.confidence === "number" ? d.confidence : row.confidence,
      status: "open",
    });
  }
  return inserted;
}

export function draftNoteRowsToActionItems(
  rows: DraftNoteActionRow[],
): SyncedActionItemRow[] {
  return rows.map((row, index) => ({
    id: `${DRAFT_NOTE_ACTION_ID_PREFIX}${index}`,
    content: row.content,
    task_title: row.task_title ?? null,
    assignee: row.assignee,
    assignee_user_id: row.assignee_user_id,
    due_date: row.due_date,
    confidence: row.confidence,
    status: "open" as const,
  }));
}

type DraftActionPersistInput = {
  content: string;
  task_title?: string | null;
  assignee: string | null;
  assignee_user_id: string | null;
  due_date: string | null;
  confidence?: number | null;
  status: "open" | "done" | "cancelled";
};

/** Edit UI rows → ai_draft_notes.action_items (empty/cancelled rows omitted). */
export function actionItemsToDraftNoteRows(items: DraftActionPersistInput[]): DraftNoteActionRow[] {
  return items
    .filter((item) => item.status !== "cancelled" && item.content.trim())
    .map((item) => ({
      content: item.content.trim(),
      task_title: item.task_title?.trim() || null,
      assignee: item.assignee,
      assignee_user_id: item.assignee_user_id,
      due_date: item.due_date?.trim().slice(0, 10) ?? null,
      confidence: item.confidence ?? null,
    }));
}
