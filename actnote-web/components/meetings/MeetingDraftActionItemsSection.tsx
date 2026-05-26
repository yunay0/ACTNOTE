"use client";

import { useState, type ReactElement, type ReactNode } from "react";
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
import { workspaceMemberInitials } from "@/lib/user/member-display";

/** Figma 157:11934 — 필수 Assignee / Due Date 외곽 (항상 주황, 클릭 가능) */
const MANDATORY_ORANGE_SHELL =
  "flex min-h-[52px] w-full min-w-[7.5rem] items-center rounded-lg border-2 border-[#ff6b35] bg-[#fff4f0] px-3 py-2.5 text-left transition-colors";

const MANDATORY_ORANGE_BUTTON = `${MANDATORY_ORANGE_SHELL} cursor-pointer hover:bg-[#ffe8df] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6b35]/40`;

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
  avatar_url?: string | null;
  name?: string | null;
}

interface MeetingDraftActionItemsSectionProps {
  items: ActionRow[];
  members: WorkspaceMemberLite[];
  participantNames?: string[];
  editMode: boolean;
  canPatchInteractive: boolean;
  onPatchRow: (
    rowId: string,
    patch: Record<string, string | null | undefined>,
  ) => Promise<{ ok: boolean; error?: string }>;
  onContentDraftChange?: (rowId: string, next: string) => void;
}

function formatDuePill(date: string | null): string {
  if (date?.trim()) {
    const slice = date.trim().slice(0, 10);
    const d = new Date(`${slice}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
    }
  }
  return "";
}

function assigneePillLabel(row: ActionRow): string {
  const raw = row.assignee?.trim();
  if (!raw) return "";
  const paren = raw.indexOf(" (");
  return paren > 0 ? raw.slice(0, paren) : raw;
}

function initialDatetimePickerValue(row: ActionRow): string {
  if (row.due_date?.trim()) return dueDateYmdToDatetimeLocalStart(row.due_date) ?? "";
  return "";
}

/** Figma — 미입력 시 빨간 ? pill */
function GapPill(): ReactElement {
  return (
    <span className="inline-flex h-5 min-w-[2.75rem] items-center justify-center gap-1 rounded-full bg-[#ef4444] px-3 text-[15px] font-bold tracking-tight text-white">
      <span className="size-2.5 shrink-0 rounded-full bg-white/40" aria-hidden />
      ?
    </span>
  );
}

/** Figma — 입력 완료 시 회색 pill (Mina, 05/09/2026) */
function FilledValuePill({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className="inline-flex h-5 max-w-full items-center gap-1.5 rounded-full bg-[#f4f4f4] py-0.5 pl-1.5 pr-3 text-[15px] font-medium text-[#94a3b8]">
      <span className="size-2.5 shrink-0 rounded-full bg-[#cbd5e1]" aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * G1: assignee 전용 pill — 회색 점 자리에 사용자 프로필 사진(또는 initials) 표시.
 */
function AssigneePill({
  label,
  member,
}: {
  label: string;
  member: WorkspaceMemberLite | null;
}): ReactElement {
  const initials = member
    ? workspaceMemberInitials(member.name ?? member.displayName ?? null, member.email)
    : "?";
  const hasAvatar = Boolean(member?.avatar_url);
  return (
    <span className="inline-flex h-5 max-w-full items-center gap-1.5 rounded-full bg-[#f4f4f4] py-0.5 pl-0.5 pr-3 text-[15px] font-medium text-[#94a3b8]">
      {hasAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member!.avatar_url!}
          alt=""
          className="size-4 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex size-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#4284f4] to-[#34a853] text-[8px] font-bold leading-none text-white"
        >
          {initials}
        </span>
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

function MandatoryAssigneeCell({
  row,
  interactive,
  onOpen,
  assigneeMember,
}: {
  row: ActionRow;
  interactive: boolean;
  onOpen: () => void;
  assigneeMember: WorkspaceMemberLite | null;
}): ReactElement {
  const needsA = draftActionNeedsAssigneeGap(row);
  const label = assigneePillLabel(row);
  const inner =
    needsA || !label ? (
      <GapPill />
    ) : (
      <AssigneePill label={label} member={assigneeMember} />
    );

  if (interactive) {
    return (
      <button
        type="button"
        className={MANDATORY_ORANGE_BUTTON}
        onClick={onOpen}
        aria-label={needsA ? "Assign member — required" : `Assignee: ${label}. Click to change.`}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={`${MANDATORY_ORANGE_SHELL} opacity-85`} aria-label="Assignee">
      {inner}
    </div>
  );
}

function MandatoryDueCell({
  row,
  interactive,
  onOpen,
}: {
  row: ActionRow;
  interactive: boolean;
  onOpen: () => void;
}): ReactElement {
  const needsD = draftActionNeedsDueGap(row);
  const dateLabel = formatDuePill(row.due_date ?? null);
  const inner = needsD || !dateLabel ? <GapPill /> : <FilledValuePill>{dateLabel}</FilledValuePill>;

  if (interactive) {
    return (
      <button
        type="button"
        className={MANDATORY_ORANGE_BUTTON}
        onClick={onOpen}
        aria-label={needsD ? "Set due date — required" : `Due date: ${dateLabel}. Click to change.`}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={`${MANDATORY_ORANGE_SHELL} opacity-85`} aria-label="Due date">
      {inner}
    </div>
  );
}

/**
 * Draft Action Items — Figma 157:11934 (주황 필수 칸 + ? / 회색 pill).
 */
export function MeetingDraftActionItemsSection(props: MeetingDraftActionItemsSectionProps): ReactElement {
  const [dueModalRowId, setDueModalRowId] = useState<string | null>(null);
  const [assignModalRowId, setAssignModalRowId] = useState<string | null>(null);
  const [duePickerInitial, setDuePickerInitial] = useState("");
  const [assignSaving, setAssignSaving] = useState(false);
  const [dueSaving, setDueSaving] = useState(false);

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
    setDueSaving(true);
    const r = await props.onPatchRow(dueModalRowId, { due_date: parsed.due_date });
    setDueSaving(false);
    if (!r.ok) {
      alert(r.error ?? "Failed to save deadline.");
      return;
    }
    setDueModalRowId(null);
  }

  async function assignMemberFromModal(m: WorkspaceMemberLite): Promise<void> {
    if (!assignModalRowId) return;
    setAssignSaving(true);
    const label = `${m.displayName}${m.email ? ` (${m.email})` : ""}`;
    const r = await props.onPatchRow(assignModalRowId, {
      assignee_user_id: m.user_id,
      assignee: label,
    });
    setAssignSaving(false);
    if (!r.ok) {
      alert(r.error ?? "Failed to assign member.");
      return;
    }
    setAssignModalRowId(null);
  }

  const interactive = props.canPatchInteractive;
  const activeRows = props.items.filter((row) => row.status !== "cancelled");

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
        <table className="w-full min-w-[680px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[#e8ecf1] bg-[#f8fafc]">
              <th className="w-[28%] px-4 py-3 font-bold text-[#0a2540]">
                Assignee <span className="text-[#ff6b35]">*</span>
              </th>
              <th className="w-[20%] px-4 py-3 font-bold text-[#0a2540]">
                Due Date <span className="text-[#ff6b35]">*</span>
              </th>
              <th className="px-4 py-3 font-bold text-[#0a2540]">
                Task Description <span className="text-[#ff6b35]">*</span>
              </th>
            </tr>
          </thead>
          <tbody className="text-[#0a2540]">
            {activeRows.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-[#94a3b8]">
                  No action items yet. Run analysis again or add a row below.
                </td>
              </tr>
            ) : (
              activeRows.map((row) => (
                <tr key={row.id} className="border-b border-[#f1f5f9] align-top">
                  <td className="px-4 py-3">
                    <MandatoryAssigneeCell
                      row={row}
                      interactive={interactive}
                      onOpen={() => setAssignModalRowId(row.id)}
                      assigneeMember={
                        row.assignee_user_id
                          ? props.members.find((m) => m.user_id === row.assignee_user_id) ?? null
                          : null
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <MandatoryDueCell
                      row={row}
                      interactive={interactive}
                      onOpen={() => openDeadlineModal(row)}
                    />
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
                      <ul className="list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-[#64748b]">
                        <li>{row.content || "—"}</li>
                      </ul>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DraftDueDateTimeModal
        open={dueModalRowId != null}
        initialDatetimeLocal={duePickerInitial}
        saving={dueSaving}
        onClose={() => !dueSaving && setDueModalRowId(null)}
        onConfirm={(v) => void saveDeadlineFromModal(v)}
      />

      <DraftAssignMemberModal
        open={assignModalRowId != null}
        members={props.members}
        participantNames={props.participantNames}
        saving={assignSaving}
        onClose={() => !assignSaving && setAssignModalRowId(null)}
        onConfirm={(m) => void assignMemberFromModal(m)}
      />
    </>
  );
}
