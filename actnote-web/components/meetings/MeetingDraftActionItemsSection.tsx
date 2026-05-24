"use client";

import { useMemo, useState, type ReactElement } from "react";
import { User, CalendarClock, Loader2 } from "lucide-react";
import {
  draftActionNeedsAssigneeGap,
  draftActionNeedsDueGap,
} from "@/lib/meetings/draft-action-gaps";
import {
  dueDateYmdToDatetimeLocalStart,
  fromDatetimeLocalToDueFields,
  utcIsoToDatetimeLocalValue,
} from "@/lib/meetings/deadline-local";

const ORANGE_FOCUS = "border-2 border-[#ff6b35] bg-[#fff4f0] ring-2 ring-[#ff6b35]/25";

interface ActionRow {
  id: string;
  content: string;
  assignee: string | null;
  assignee_user_id: string | null;
  due_date: string | null;
  due_at: string | null;
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
  editMode: boolean;
  canPatchInteractive: boolean;
  onPatchRow: (
    rowId: string,
    patch: Record<string, string | null | undefined>,
  ) => Promise<{ ok: boolean; error?: string }>;
  onContentDraftChange?: (rowId: string, next: string) => void;
}

function formatDueCell(at: string | null, date: string | null): string {
  if (at?.trim()) {
    const d = new Date(at);
    return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  }
  if (date?.trim()) {
    const slice = date.trim().slice(0, 10);
    const d = new Date(`${slice}T12:00:00`);
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-US", { dateStyle: "medium" });
  }
  return "Due missing";
}

function initialDatetimePickerValue(row: ActionRow): string {
  if (row.due_at?.trim()) {
    const local = utcIsoToDatetimeLocalValue(row.due_at);
    return local ?? "";
  }
  if (row.due_date?.trim()) return dueDateYmdToDatetimeLocalStart(row.due_date) ?? "";
  return "";
}

function membersFilter(members: WorkspaceMemberLite[], q: string): WorkspaceMemberLite[] {
  const s = q.trim().toLowerCase();
  if (!s) return members;
  return members.filter(
    (m) =>
      m.displayName.toLowerCase().includes(s) ||
      Boolean(m.email && m.email.toLowerCase().includes(s)),
  );
}

/**
 * Draft 상세 단계에서 액션 아이템 표 + 담당/마감 누락 오렌지 클릭 수정.
 */
export function MeetingDraftActionItemsSection(props: MeetingDraftActionItemsSectionProps): ReactElement {
  const [dueModalRowId, setDueModalRowId] = useState<string | null>(null);
  const [assignModalRowId, setAssignModalRowId] = useState<string | null>(null);
  const [deadlineDraft, setDeadlineDraft] = useState("");
  const [assignQ, setAssignQ] = useState("");
  const [pickLoading, setPickLoading] = useState(false);

  const dueRow = useMemo(
    () => props.items.find((x) => x.id === dueModalRowId) ?? null,
    [props.items, dueModalRowId],
  );

  function openDeadlineModal(row: ActionRow): void {
    setDeadlineDraft(initialDatetimePickerValue(row));
    setDueModalRowId(row.id);
  }

  async function saveDeadlineModal(): Promise<void> {
    if (!dueModalRowId) return;
    const parsed = fromDatetimeLocalToDueFields(deadlineDraft);
    if (!parsed) {
      alert("Choose a valid date and time.");
      return;
    }
    setPickLoading(true);
    const r = await props.onPatchRow(dueModalRowId, {
      due_at: parsed.due_at,
      due_date: parsed.due_date,
    });
    setPickLoading(false);
    if (!r.ok) {
      alert(r.error ?? "Failed to save deadline.");
      return;
    }
    setDueModalRowId(null);
  }

  async function assignMember(m: WorkspaceMemberLite): Promise<void> {
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
    setAssignQ("");
  }

  const filteredMembers = membersFilter(props.members, assignQ);

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
                          setAssignQ("");
                        }}
                        className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${needsA ? ORANGE_FOCUS : "border border-transparent bg-[#fafbfc]"} ${props.canPatchInteractive && needsA ? "cursor-pointer hover:bg-orange-50" : ""}`}
                      >
                        <span className="flex items-center gap-2">
                          <User className="size-4 shrink-0 text-[#64748b]" aria-hidden />
                          <span className="truncate">
                            {needsA ? "Missing assignee" : (row.assignee ?? "Assigned")}
                          </span>
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
                          {formatDueCell(row.due_at ?? null, row.due_date ?? null)}
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

      {dueModalRowId && dueRow ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" role="dialog" aria-labelledby="due-title">
            <p id="due-title" className="text-[16px] font-bold text-[#0a2540]">
              Set due date &amp; time
            </p>
            <p className="mt-1 text-[13px] text-[#64748b]">Choose when this action must be finished.</p>
            <input
              type="datetime-local"
              value={deadlineDraft}
              onChange={(e) => setDeadlineDraft(e.target.value)}
              className="mt-4 w-full rounded-xl border-2 border-[#e2e8f0] px-4 py-3 text-[15px] outline-none focus:border-[#ff6b35]"
            />
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setDueModalRowId(null)}
                className="h-11 rounded-xl border border-[#e2e8f0] px-5 text-[14px] font-bold text-[#64748b] hover:bg-[#f8fafc]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={pickLoading}
                onClick={() => void saveDeadlineModal()}
                className="inline-flex h-11 min-w-[7rem] items-center justify-center gap-2 rounded-xl bg-[#ff6b35] px-6 text-[14px] font-bold text-white hover:opacity-90 disabled:opacity-60"
              >
                {pickLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {assignModalRowId ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm">
          <div
            className="flex max-h-[min(520px,90vh)] w-full max-w-md flex-col rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-labelledby="asg-title"
          >
            <p id="asg-title" className="text-[16px] font-bold text-[#0a2540]">
              Assign to workspace member
            </p>
            <input
              type="search"
              value={assignQ}
              onChange={(e) => setAssignQ(e.target.value)}
              placeholder="Search by name or email…"
              className="mt-4 w-full rounded-xl border-2 border-[#e2e8f0] px-4 py-2.5 text-[14px] outline-none focus:border-[#ff6b35]"
              autoComplete="off"
            />
            <div className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {filteredMembers.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-[#94a3b8]">No members match.</p>
              ) : (
                filteredMembers.map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    disabled={pickLoading}
                    onClick={() => void assignMember(m)}
                    className="flex w-full flex-col items-start rounded-xl border border-[#f1f5f9] bg-[#fafbfc] px-4 py-3 text-left transition-colors hover:border-[#ff6b35] hover:bg-[#fff8f5] disabled:opacity-60"
                  >
                    <span className="font-semibold text-[#0a2540]">{m.displayName}</span>
                    <span className="mt-0.5 text-[12px] text-[#64748b]">{m.email}</span>
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setAssignModalRowId(null);
                setAssignQ("");
              }}
              className="mt-6 h-11 rounded-xl border border-[#e2e8f0] text-[14px] font-bold text-[#64748b] hover:bg-[#f8fafc]"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
