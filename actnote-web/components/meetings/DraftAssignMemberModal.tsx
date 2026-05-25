"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ArrowLeft, Loader2, Search, X } from "lucide-react";
import { workspaceMemberDisplayName } from "@/lib/user/member-display";

export interface DraftAssignMemberOption {
  user_id: string;
  displayName: string;
  email: string;
}

function initialsForMember(name: string, email: string): string {
  const base = workspaceMemberDisplayName(name, email).trim() || email;
  if (!base) return "??";
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[parts.length - 1]?.[0];
    if (a && b) return `${a}${b}`.toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}

function membersFilter(members: DraftAssignMemberOption[], q: string): DraftAssignMemberOption[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return members.filter(
    (m) =>
      m.displayName.toLowerCase().includes(s) ||
      Boolean(m.email && m.email.toLowerCase().includes(s)),
  );
}

/** 회의 참석자 이름·이메일과 매칭되는 멤버 우선, 최대 3명 */
function resolveRecommended(
  members: DraftAssignMemberOption[],
  participantNames: string[],
): DraftAssignMemberOption[] {
  const picks: DraftAssignMemberOption[] = [];
  const needles = participantNames.map((p) => p.trim().toLowerCase()).filter(Boolean);

  for (const m of members) {
    if (picks.length >= 3) break;
    const dn = m.displayName.toLowerCase();
    const em = m.email.toLowerCase();
    const hit = needles.some(
      (p) => p === dn || p === em || dn.includes(p) || p.includes(dn) || (em && em.includes(p)),
    );
    if (hit) picks.push(m);
  }
  for (const m of members) {
    if (picks.length >= 3) break;
    if (!picks.some((x) => x.user_id === m.user_id)) picks.push(m);
  }
  return picks;
}

function MemberAvatar({ member, size = 40 }: { member: DraftAssignMemberOption; size?: number }): ReactElement {
  const dim = `${size}px`;
  const initials = initialsForMember(member.displayName, member.email);
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-[#f4f4f4] text-[13px] font-semibold text-[#94a3b8]"
      style={{ width: dim, height: dim }}
    >
      {initials}
    </div>
  );
}

function RecommendedChip({
  member,
  onPick,
}: {
  member: DraftAssignMemberOption;
  onPick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onPick}
      className="inline-flex h-5 max-w-full items-center gap-1.5 rounded-full bg-[#f4f4f4] py-0.5 pl-1.5 pr-3 text-[15px] font-medium text-[#94a3b8] transition-colors hover:bg-[#e8ecf1]"
    >
      <span className="size-2.5 shrink-0 rounded-full bg-[#cbd5e1]" aria-hidden />
      <span className="truncate">{member.displayName}</span>
    </button>
  );
}

export interface DraftAssignMemberModalProps {
  open: boolean;
  members: DraftAssignMemberOption[];
  /** 회의 참석자 — Recommended 칩 우선순위 */
  participantNames?: string[];
  saving: boolean;
  onClose: () => void;
  onConfirm: (member: DraftAssignMemberOption) => void;
}

/**
 * Draft 액션 담당자 지정 — Figma 157:13493 / 검색·드롭다운 157:9227.
 */
export function DraftAssignMemberModal(props: DraftAssignMemberModalProps): ReactElement | null {
  const [searchQ, setSearchQ] = useState("");
  const [selected, setSelected] = useState<DraftAssignMemberOption | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const recommended = useMemo(
    () => resolveRecommended(props.members, props.participantNames ?? []),
    [props.members, props.participantNames],
  );

  const filtered = useMemo(() => membersFilter(props.members, searchQ), [props.members, searchQ]);

  const showDropdown = searchQ.trim().length > 0;

  const reset = useCallback(() => {
    setSearchQ("");
    setSelected(null);
  }, []);

  useEffect(() => {
    if (props.open) reset();
  }, [props.open, reset]);

  function pickMember(m: DraftAssignMemberOption): void {
    setSelected(m);
    setSearchQ(m.displayName);
  }

  function handleAssign(): void {
    if (!selected) {
      alert("Select a member from search or Recommended, then tap Assign.");
      return;
    }
    props.onConfirm(selected);
  }

  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-[#0a2540]/60 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className="flex max-h-[min(92vh,560px)] w-full max-w-[480px] flex-col items-center gap-3 overflow-y-auto rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-member-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex size-16 shrink-0 items-center justify-center rounded-[32px] bg-[#ef4444] text-[29px] text-white"
          aria-hidden
        >
          <Search className="size-8" strokeWidth={2.25} />
        </div>

        <div className="w-full text-center">
          <h2 id="assign-member-title" className="text-2xl font-bold text-[#0a2540]">
            Assign Member
          </h2>
          <p className="mt-2 text-[14px] leading-6 text-[#64748b]">
            Please select a member for this task.
          </p>
        </div>

        <div className="flex w-full max-w-[412px] flex-wrap items-center gap-2 rounded-[25px] border border-[#fee2e2] bg-[#f4f4f4] px-5 py-4">
          <span className="list-item list-inside text-[13px] font-bold text-[#0a2540]">Assignee</span>
          {selected ? (
            <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-[#f4f4f4] py-0.5 pl-1.5 pr-3 text-[15px] font-medium text-[#0a2540]">
              <span className="size-2.5 shrink-0 rounded-full bg-[#cbd5e1]" aria-hidden />
              {selected.displayName}
            </span>
          ) : (
            <span className="inline-flex h-5 min-w-[2.75rem] items-center justify-center gap-1 rounded-full bg-[#ef4444] px-3 text-[15px] font-bold text-white">
              <span className="size-2.5 rounded-full bg-white/40" aria-hidden />
              ?
            </span>
          )}
        </div>

        {recommended.length > 0 ? (
          <div className="w-full max-w-[412px]">
            <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#0a2540]">
              <span className="text-[11px]" aria-hidden>
                ▼
              </span>
              Recommended
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {recommended.map((m) => (
                <RecommendedChip key={m.user_id} member={m} onPick={() => pickMember(m)} />
              ))}
            </div>
          </div>
        ) : null}

        <div className="relative w-full max-w-[412px]">
          <div
            className={`flex h-14 items-center gap-1 rounded-[28px] border bg-white px-1 ${
              showDropdown ? "border-[#0a2540]" : "border-[#757575]"
            }`}
          >
            {showDropdown ? (
              <button
                type="button"
                className="flex size-12 shrink-0 items-center justify-center rounded-full text-[#0a2540] hover:bg-[#f8fafc]"
                aria-label="Clear search"
                onClick={() => {
                  setSearchQ("");
                  setSelected(null);
                  inputRef.current?.focus();
                }}
              >
                <ArrowLeft className="size-5" />
              </button>
            ) : (
              <div className="size-12 shrink-0" aria-hidden />
            )}
            <input
              ref={inputRef}
              type="search"
              value={searchQ}
              onChange={(e) => {
                setSearchQ(e.target.value);
                if (selected && e.target.value.trim() !== selected.displayName) {
                  setSelected(null);
                }
              }}
              placeholder="Search Member"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-[#0a2540] outline-none placeholder:text-[#d9d9d9]"
            />
            {searchQ.trim() ? (
              <button
                type="button"
                className="flex size-12 shrink-0 items-center justify-center rounded-full text-[#0a2540] hover:bg-[#f8fafc]"
                aria-label="Clear search text"
                onClick={() => {
                  setSearchQ("");
                  setSelected(null);
                  inputRef.current?.focus();
                }}
              >
                <X className="size-5" />
              </button>
            ) : (
              <div className="flex size-12 shrink-0 items-center justify-center text-[#757575]" aria-hidden>
                <Search className="size-6" />
              </div>
            )}
          </div>

          {showDropdown ? (
            <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-[220px] overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white py-1 shadow-lg">
              {filtered.length === 0 ? (
                <p className="px-4 py-6 text-center text-[14px] text-[#94a3b8]">No members match.</p>
              ) : (
                filtered.map((m) => (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() => pickMember(m)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#f8fafc]"
                  >
                    <MemberAvatar member={m} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[16px] leading-6 text-[#1d1b20]">{m.displayName}</p>
                      <p className="truncate text-[14px] leading-5 text-[#49454f]">{m.email}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        <div className="flex w-full max-w-[412px] gap-3 pt-2">
          <button
            type="button"
            disabled={props.saving}
            onClick={props.onClose}
            className="flex h-12 flex-1 items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] bg-white text-[15px] font-bold text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={props.saving || !selected}
            onClick={handleAssign}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[10px] bg-[#ef4444] text-[15px] font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {props.saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
