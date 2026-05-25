"use client";

import { useState, type ReactElement } from "react";
import { User, CalendarClock } from "lucide-react";
import { DraftAssignMemberModal } from "@/components/meetings/DraftAssignMemberModal";
import { DraftDueDateTimeModal } from "@/components/meetings/DraftDueDateTimeModal";
import {
  draftActionNeedsAssigneeGap,
  draftActionNeedsDueGap,
} from "@/lib/meetings/draft-action-gaps";
import {
  dueDateYmdToDatetimeLocalStart,
  fromDatetimeLocalToDueFields,
} from "@/lib/meetings/deadline-local";

const ORANGE_FOCUS = "border-2 border-[#ff6b35] bg-[#fff4f0] ring-2 ring-[#ff6b35]/25";

interface ActionRow {
  id: string;
  content: string;
  assignee: string | null;
  assignee_user_id: string | null;
  due_date: string | null;
  status: "open" | "done" | "cancelled";
}

interface WorkspaceMemberLite {
  user_id: string;
  displayName: string;
  email: string;
}

interface MeetingDraftActionItemsSectionProps {
  items: ActionRow[];
  members: WorkspaceMemberLite[];
  /** 회의 참석자 — Assign 모달 Recommended 칩 */
  participantNames?: string[];
  editMode: boolean;
  canPatchInteractive: boolean;
  onPatchRow: (
    rowId: string,
    patch: Record<string, string | null | undefined>,
  ) => Promise<{ ok: boolean; error?: string }>;
  onContentDraftChange?: (rowId: string, next: string) => void;
}

function formatDueCell(date: string | null): string {
  if (date?.trim()) {
    const slice = date.trim().slice(0, 10);
    const d = new Date(`${slice}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-US", { dateStyle: "medium" });
  }
  return "Due missing";
}

function initialDatetimePickerValue(row: ActionRow): string {
  if (row.due_date?.trim()) return dueDateYmdToDatetimeLocalStart(row.due_date) ?? "";
  return "";
}

/**
 * Draft 상세 단계에서 액션 아이템 표 + 담당/마감 누락 오렌지 클릭 수정.
 */
export function MeetingDraftActionItemsSection(props: MeetingDraftActionItemsSectionProps): ReactElement {
  const [dueModalRowId, setDueModalRowId] = useState<string | null>(null);
  const [assignModalRowId, setAssignModalRowId] = useState<string | null>(null);
  const [duePickerInitial, setDuePickerInitial] = useState("");
  const [pickLoading, setPickLoading] = useState(false);

  function openDeadlineModal(row: ActionRow): void {
    setDuePickerInitial(initialDatetimePickerValue(row));
    setDueModalRowId(row.id);
  }

  async function saveDeadlineFromModal(datetimeLocal: string): Promise<void> {
    if (!dueModalRowId) return;
    const parsed = fromDatetimeLocalToDueFields(datetimeLocal);
    if (!parsed) {
      alert("Choose a valid date and time.");
      return;
    }
    setPickLoading(true);
    const r = await props.onPatchRow(dueModalRowId, {
      due_date: parsed.due_date,
    });
    setPickLoading(false);
    if (!r.ok) {
      alert(r.error ?? "Failed to save deadline.");
      return;
    }
    setDueModalRowId(null);
  }

  async function assignMemberFromModal(m: WorkspaceMemberLite): Promise<void> {
    if (!assignModalRowId) return;
    setPickLoading(true);
    const label = `${m.displayName}${m.email ? ` (${m.email})` : ""}`;
    const r = await props.onPatchRow(assignModalRowId, {
      assignee_user_id: m.user_id,
      assignee: label,
    });
    setPickLoading(false);
    if (!r.ok) {
      alert(r.error ?? "Failed to assign member.");
      return;
    }
    setAssignModalRowId(null);
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[#e8ecf1] bg-[#f8fafc]">
              <th className="px-4 py-3 font-bold text-[#0a2540]">
                Assignee <span className="text-[#ff6b35]">*</span>
              </th>
              <th className="px-4 py-3 font-bold text-[#0a2540]">
                Due Date <span className="text-[#ff6b35]">*</span>
              </th>
              <th className="px-4 py-3 font-bold text-[#0a2540]">
                Task Description <span className="text-[#ff6b35]">*</span>
              </th>
            </tr>
          </thead>
          <tbody className="text-[#0a2540]">
            {props.items.filter((row) => row.status !== "cancelled").length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-[#94a3b8]">
                  No action items yet.
                </td>
              </tr>
            ) : (
              props.items.map((row) => {
                if (row.status === "cancelled") return null;
                const needsA = draftActionNeedsAssigneeGap(row);
                const needsD = draftActionNeedsDueGap(row);
                return (
                  <tr key={row.id} className="border-b border-[#f1f5f9] align-top">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!props.canPatchInteractive}
                        onClick={() => {
                          if (!needsA || !props.canPatchInteractive) return;
                          setAssignModalRowId(row.id);
                        }}
                        className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${needsA ? ORANGE_FOCUS : "border border-transparent bg-[#fafbfc]"} ${props.canPatchInteractive && needsA ? "cursor-pointer hover:bg-orange-50" : ""}`}
                      >
                        <span className="flex items-center gap-2">
                          {needsA ? (
                            <span className="inline-flex h-5 min-w-[2.75rem] shrink-0 items-center justify-center gap-1 rounded-full bg-[#ef4444] px-3 text-[15px] font-bold text-white">
                              <span className="size-2.5 rounded-full bg-white/40" aria-hidden />
                              ?
                            </span>
                          ) : (
                            <>
                              <User className="size-4 shrink-0 text-[#64748b]" aria-hidden />
                              <span className="truncate">{row.assignee ?? "Assigned"}</span>
                            </>
                          )}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!props.canPatchInteractive}
                        onClick={() => {
                          if (!needsD || !props.canPatchInteractive) return;
                          openDeadlineModal(row);
                        }}
                        className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${needsD ? ORANGE_FOCUS : "border border-transparent bg-[#fafbfc]"} ${props.canPatchInteractive && needsD ? "cursor-pointer hover:bg-orange-50" : ""}`}
                      >
                        <span className="flex items-center gap-2">
                          <CalendarClock className="size-4 shrink-0 text-[#64748b]" aria-hidden />
                          {formatDueCell(row.due_date ?? null)}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      {props.editMode ? (
                        <textarea
                          value={row.content}
                          onChange={(e) => props.onContentDraftChange?.(row.id, e.target.value)}
                          rows={Math.min(8, Math.max(2, row.content.split("\n").length + 1))}
                          placeholder="Describe the action..."
                          className="w-full resize-y rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-[13px] outline-none focus:border-[#ff6b35]"
                        />
                      ) : (
                        <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
                          <li>{row.content || "—"}</li>
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <DraftDueDateTimeModal
        open={dueModalRowId != null}
        initialDatetimeLocal={duePickerInitial}
        saving={pickLoading}
        onClose={() => setDueModalRowId(null)}
        onConfirm={(v) => void saveDeadlineFromModal(v)}
      />

      <DraftAssignMemberModal
        open={assignModalRowId != null}
        members={props.members}
        participantNames={props.participantNames}
        saving={pickLoading}
        onClose={() => setAssignModalRowId(null)}
        onConfirm={(m) => void assignMemberFromModal(m)}
      />
    </>
  );
}
