"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ArrowLeft, Loader2, Search, X } from "lucide-react";
import { DraftModalPortal } from "@/components/meetings/DraftModalPortal";
import { suggestedParticipantAssignees } from "@/lib/meetings/action-item-assignees";
import { workspaceMemberDisplayName } from "@/lib/user/member-display";

export interface DraftAssignMemberOption {
  user_id: string;
  displayName: string;
  email: string;
  avatar_url?: string | null;
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
  if (!s) return members;
  return members.filter(
    (m) =>
      m.displayName.toLowerCase().includes(s) ||
      Boolean(m.email && m.email.toLowerCase().includes(s)),
  );
}

function MemberAvatar({ member, size = 40 }: { member: DraftAssignMemberOption; size?: number }): ReactElement {
  const [broken, setBroken] = useState(false);
  const dim = `${size}px`;
  const initials = initialsForMember(member.displayName, member.email);
  const url = member.avatar_url?.trim();

  if (url && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="shrink-0 rounded-full object-cover"
        style={{ width: dim, height: dim }}
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-[#f4f4f4] text-[13px] font-semibold text-[#94a3b8]"
      style={{ width: dim, height: dim, fontSize: size <= 24 ? 10 : 13 }}
    >
      {initials}
    </div>
  );
}

function RecommendedChip({
  member,
  selected,
  onPick,
}: {
  member: DraftAssignMemberOption;
  selected: boolean;
  onPick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-full py-0.5 pl-1 pr-3 text-[15px] font-medium transition-colors ${
        selected ? "bg-[#fff4f0] text-[#0a2540] ring-2 ring-[#ff6b35]/40" : "bg-[#f4f4f4] text-[#94a3b8] hover:bg-[#e8ecf1]"
      }`}
    >
      <MemberAvatar member={member} size={22} />
      <span className="truncate">{member.displayName}</span>
    </button>
  );
}

export interface DraftAssignMemberModalProps {
  open: boolean;
  members: DraftAssignMemberOption[];
  participantNames?: string[];
  saving: boolean;
  onClose: () => void;
  onConfirm: (member: DraftAssignMemberOption) => void;
}

/** Figma 157:13493 / 157:9227 */
export function DraftAssignMemberModal(props: DraftAssignMemberModalProps): ReactElement | null {
  const [searchQ, setSearchQ] = useState("");
  const [selected, setSelected] = useState<DraftAssignMemberOption | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestedParticipants = useMemo(
    () => suggestedParticipantAssignees(props.members, props.participantNames ?? []),
    [props.members, props.participantNames],
  );

  const listMembers = useMemo(() => membersFilter(props.members, searchQ), [props.members, searchQ]);

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
      alert("Select a member from the list or Recommended, then tap Assign.");
      return;
    }
    props.onConfirm(selected);
  }

  if (!props.open) return null;

  return (
    <DraftModalPortal open={props.open}>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0a2540]/60 p-4 backdrop-blur-[2px]"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget && !props.saving) props.onClose();
        }}
      >
        <div
          className="flex max-h-[min(90vh,680px)] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-member-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-8 pb-4">
            <div className="flex flex-col items-center gap-3">
              <div
                className="flex size-16 shrink-0 items-center justify-center rounded-[32px] bg-[#ef4444] text-white"
                aria-hidden
              >
                <Search className="size-8" strokeWidth={2.25} />
              </div>

              <div className="w-full text-center">
                <h2 id="assign-member-title" className="text-2xl font-bold text-[#0a2540]">
                  Assign Member
                </h2>
                <p className="mt-2 text-[14px] leading-6 text-[#64748b]">
                  Any workspace member can be assigned, including people not listed as meeting
                  participants.
                </p>
              </div>

              <div className="flex w-full max-w-[412px] flex-wrap items-center gap-2 rounded-[25px] border border-[#fee2e2] bg-[#f4f4f4] px-5 py-4">
                <span className="text-[13px] font-bold text-[#0a2540]">Assignee</span>
                {selected ? (
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[#fff4f0] py-0.5 pl-1 pr-3 text-[15px] font-medium text-[#0a2540] ring-1 ring-[#ff6b35]/30">
                    <MemberAvatar member={selected} size={20} />
                    {selected.displayName}
                  </span>
                ) : (
                  <GapPillInline />
                )}
              </div>

              {suggestedParticipants.length > 0 ? (
                <div className="w-full max-w-[412px]">
                  <p className="flex items-center gap-1.5 text-[13px] font-bold text-[#0a2540]">
                    <span className="text-[11px]" aria-hidden>
                      ▼
                    </span>
                    Meeting participants
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {suggestedParticipants.map((m) => (
                      <RecommendedChip
                        key={m.user_id}
                        member={m}
                        selected={selected?.user_id === m.user_id}
                        onPick={() => pickMember(m)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="w-full max-w-[412px]">
                <p className="mb-2 text-[13px] font-bold text-[#0a2540]">All workspace members</p>
                <div className="flex h-14 items-center gap-1 rounded-[28px] border border-[#757575] bg-white px-1 focus-within:border-[#0a2540]">
                  {searchQ.trim() ? (
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
                    type="text"
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

                <div
                  className="mt-2 max-h-[200px] overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white py-1 shadow-lg"
                  role="listbox"
                  aria-label="Workspace members"
                >
                  {props.members.length === 0 ? (
                    <p className="px-4 py-6 text-center text-[14px] text-[#94a3b8]">No workspace members loaded.</p>
                  ) : listMembers.length === 0 ? (
                    <p className="px-4 py-6 text-center text-[14px] text-[#94a3b8]">No members match.</p>
                  ) : (
                    listMembers.map((m) => (
                      <button
                        key={m.user_id}
                        type="button"
                        role="option"
                        aria-selected={selected?.user_id === m.user_id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickMember(m);
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#f8fafc] ${
                          selected?.user_id === m.user_id ? "bg-[#fff4f0]" : ""
                        }`}
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
              </div>
            </div>
          </div>

          <div className="flex shrink-0 gap-3 border-t border-[#e2e8f0] bg-white px-8 py-4">
            <button
              type="button"
              onClick={props.onClose}
              className="flex h-12 flex-1 items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] bg-white text-[15px] font-bold text-[#64748b] hover:bg-[#f8fafc]"
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
    </DraftModalPortal>
  );
}

function GapPillInline(): ReactElement {
  return (
    <span className="inline-flex h-6 min-w-[2.75rem] items-center justify-center gap-1 rounded-full bg-[#ef4444] px-3 text-[15px] font-bold text-white">
      <span className="size-2.5 rounded-full bg-white/40" aria-hidden />
      ?
    </span>
  );
}
