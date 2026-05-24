"use client";

import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X, AlertTriangle } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { createClient } from "@/lib/supabase/client";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import {
  allowedRecordingExtensionsLabel,
  fileAcceptAttribute,
  formatRecordingSizeMbDecimal,
  getRecordingFileIssue,
  type RecordingFileIssue,
} from "@/lib/meeting/recordingFilename";
import { workspaceMemberDisplayName } from "@/lib/user/member-display";
import { RecordingUploadErrorModal } from "@/components/meetings/RecordingUploadErrorModal";
import { UploadedRecordingPreviewCard } from "@/components/meetings/UploadedRecordingPreviewCard";
import { MEETING_TYPE_OPTIONS } from "@/lib/meetings/meeting-types";
import { submissionLooksLikeNetworkFailure } from "@/lib/meetings/submission-network-errors";

const MAX_SIZE_MB = 50;

interface Participant {
  id: string;
  value: string;
}

/** 새 회의 — 참석자 드롭다운 및 담당자 선택 */
interface WorkspaceMemberRow {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  label: string;
  sort_key: string;
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

function MemberAvatarRound(props: {
  avatarUrl: string | null;
  name: string;
  email: string;
  size: number;
  className?: string;
}) {
  const { avatarUrl, name, email, size, className = "" } = props;
  const dim = `${size}px`;
  if (avatarUrl?.trim()) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className}`}
        referrerPolicy="no-referrer"
      />
    );
  }
  const initials = initialsForMember(name, email);
  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white sm:text-[11px] ${className}`}
      style={{
        width: dim,
        height: dim,
        background: "linear-gradient(135deg, #2e5c8a 0%, #ff6b35 50%)",
      }}
    >
      {initials}
    </div>
  );
}

function sortMembersByDisplayName(rows: WorkspaceMemberRow[]): WorkspaceMemberRow[] {
  return [...rows].sort((a, b) =>
    a.sort_key.localeCompare(b.sort_key, "en", { sensitivity: "base" }),
  );
}

/** Resume generate flow after a network error (insert may have succeeded). */
interface PipelineCheckpoint {
  meetingId: string;
  audioPath: string;
  storageUploadDone: boolean;
}

function NewMeetingPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reattachMeetingId = useMemo(
    () => (searchParams.get("reattach") ?? "").trim(),
    [searchParams],
  );
  const { workspaceId } = useWorkspaceContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [meetingType, setMeetingType] = useState("");
  const [datetime, setDatetime] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [description, setDescription] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantPickerOpen, setParticipantPickerOpen] = useState(false);
  const participantPickerRef = useRef<HTMLDivElement>(null);

  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMemberRow[]>([]);
  const [responsibleUserId, setResponsibleUserId] = useState<string | null>(null);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [recordingUploadIssue, setRecordingUploadIssue] = useState<RecordingFileIssue | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  /** Figma 144:7788 — transport failure after Generate / Start AI Analysis. */
  const [networkErrorModalOpen, setNetworkErrorModalOpen] = useState(false);
  /** Figma 144:7769 — trigger succeeded; countdown to Meetings. */
  const [analysisInitiatedOpen, setAnalysisInitiatedOpen] = useState(false);
  const [analysisCountdownSecs, setAnalysisCountdownSecs] = useState(3);
  /** Figma — confirm review before inserting meeting + pipeline (142:7434 / 142:7570). */
  const [confirmAnalysisModal, setConfirmAnalysisModal] = useState(false);
  const [leaveModal, setLeaveModal] = useState(false);
  const [pendingNavTarget, setPendingNavTarget] = useState<string | null>(null);
  const pipelineCheckpointRef = useRef<PipelineCheckpoint | null>(null);
  /** Reattach-from-error: server-prefetched row + gate submit until hydrate. */
  const [reattachLoadErr, setReattachLoadErr] = useState<string | null>(null);
  const [reattachReady, setReattachReady] = useState(true);
  // 폼에 입력값이 하나라도 있으면 dirty
  const isDirty =
    title.trim() !== "" ||
    meetingType.trim() !== "" ||
    description.trim() !== "" ||
    participants.length > 0 ||
    file !== null;

  const canSubmit = useMemo(() => {
    return Boolean(
      workspaceId &&
        membersLoaded &&
        reattachReady &&
        title.trim() &&
        datetime &&
        file &&
        meetingType.trim() &&
        participants.length > 0 &&
        responsibleUserId
    );
  }, [
    workspaceId,
    membersLoaded,
    reattachReady,
    title,
    datetime,
    file,
    meetingType,
    participants.length,
    responsibleUserId,
  ]);
  const participantsNotYetAdded = useMemo(() => {
    const emails = new Set(participants.map((p) => p.value.toLowerCase()));
    return workspaceMembers.filter((m) => m.email && !emails.has(m.email.toLowerCase()));
  }, [workspaceMembers, participants]);

  // 브라우저 새로고침 / 탭 닫기 방지
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!workspaceId) {
      setWorkspaceMembers([]);
      setResponsibleUserId(null);
      setMembersLoaded(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: rowsRaw, error } = await (supabase as any)
        .from("workspace_members")
        .select("user_id, users(name, email, avatar_url)")
        .eq("workspace_id", workspaceId);

      if (cancelled) return;

      if (error) {
        console.error("[new meeting] workspace_members load:", error.message);
      }

      const rows = (rowsRaw ?? []) as Array<Record<string, unknown>>;
      const built: WorkspaceMemberRow[] = [];
      for (const r of rows) {
        const uid = typeof r.user_id === "string" ? r.user_id : "";
        if (!uid) continue;
        const rawU = r.users;
        const u = (
          Array.isArray(rawU) ? rawU[0] : rawU
        ) as Record<string, unknown> | null | undefined;
        const name = typeof u?.name === "string" ? u.name : "";
        const email = typeof u?.email === "string" ? u.email : "";
        const ar = u?.avatar_url;
        const avatar_url =
          typeof ar === "string" && ar.trim() ? ar.trim() : null;
        if (!email) continue;
        const shown = workspaceMemberDisplayName(name, email);
        const label = `${shown} (${email})`;
        const sort_key =
          workspaceMemberDisplayName(name, email).trim().toLowerCase() ||
          email.toLowerCase();
        built.push({ user_id: uid, name, email, avatar_url, label, sort_key });
      }

      const sorted = sortMembersByDisplayName(built);
      setWorkspaceMembers(sorted);

      setResponsibleUserId((prev) => {
        if (prev && sorted.some((m) => m.user_id === prev)) return prev;
        const selfRow = sorted.find((m) => m.user_id === user.id);
        return selfRow?.user_id ?? sorted[0]?.user_id ?? null;
      });
      setMembersLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!participantPickerOpen) return;
    function onMouseDown(e: MouseEvent) {
      const el = participantPickerRef.current;
      if (el && !el.contains(e.target as Node)) setParticipantPickerOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [participantPickerOpen]);

  useEffect(() => {
    if (!reattachMeetingId || !workspaceId) {
      setReattachLoadErr(null);
      setReattachReady(true);
      return;
    }

    let cancelled = false;

    async function prefetchFailedMeeting(): Promise<void> {
      setReattachReady(false);
      setReattachLoadErr(null);

      const supabase = createClient();
      const { data: row, error } = await (supabase as any)
        .from("meetings")
        .select(
          "id, title, meeting_date, meeting_type, description, responsible_user_id, participants, status",
        )
        .eq("id", reattachMeetingId)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .maybeSingle();

      if (cancelled) return;

      if (error || !row) {
        setReattachLoadErr(
          typeof error?.message === "string"
            ? error.message
            : "That meeting ID was not found in this workspace.",
        );
        setReattachReady(true);
        return;
      }

      if (typeof row.status === "string" && row.status !== "error") {
        setReattachLoadErr(
          "Reattach file is available only after an analysis stops with Error.",
        );
        setReattachReady(true);
        return;
      }

      setTitle(
        typeof row.title === "string" && row.title.trim() ? row.title : "Untitled meeting",
      );
      setDescription(typeof row.description === "string" ? row.description : "");
      setMeetingType(typeof row.meeting_type === "string" ? row.meeting_type : "");

      const partList = Array.isArray(row.participants) ? (row.participants as unknown[]) : [];
      setParticipants(partList.map((em) => ({ id: crypto.randomUUID(), value: String(em) })));

      const resp = typeof row.responsible_user_id === "string" ? row.responsible_user_id : null;
      setResponsibleUserId(resp);

      const iso = row.meeting_date as string | null | undefined;
      const dl = isoUtcToDatetimeLocalInput(iso ?? null);
      if (dl) setDatetime(dl);
      setFile(null);
      setReattachReady(true);
    }

    void prefetchFailedMeeting();
    return () => {
      cancelled = true;
    };
  }, [reattachMeetingId, workspaceId]);

  useEffect(() => {
    if (!analysisInitiatedOpen) return undefined;
    setAnalysisCountdownSecs(3);
    let secs = 3;
    const id = window.setInterval(() => {
      secs -= 1;
      setAnalysisCountdownSecs(Math.max(secs, 0));
      if (secs <= 0) {
        window.clearInterval(id);
        router.push("/meetings");
        setAnalysisInitiatedOpen(false);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [analysisInitiatedOpen, router]);

  function goMeetingsNow() {
    setAnalysisInitiatedOpen(false);
    router.push("/meetings");
  }

  function safeNavigate(href: string) {
    if (isDirty) {
      setPendingNavTarget(href);
      setLeaveModal(true);
    } else {
      router.push(href);
    }
  }

  function confirmLeave() {
    setLeaveModal(false);
    setConfirmAnalysisModal(false);
    setNetworkErrorModalOpen(false);
    setAnalysisInitiatedOpen(false);
    const target = pendingNavTarget;
    setPendingNavTarget(null);
    if (target) router.push(target);
  }

  function addParticipantFromMember(m: WorkspaceMemberRow): void {
    const low = m.email.toLowerCase();
    if (participants.some((p) => p.value.toLowerCase() === low)) return;
    setParticipants((prev) => [...prev, { id: crypto.randomUUID(), value: m.email }]);
    setParticipantPickerOpen(false);
  }

  const handleFileSelect = useCallback((f: File) => {
    const issue = getRecordingFileIssue(f, MAX_SIZE_MB);
    if (issue) {
      setRecordingUploadIssue(issue);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(f);
    setTitle((prev) => (prev.trim() ? prev : f.name.replace(/\.(mp3|m4a|wav|mp4|mov)$/i, "")));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFileSelect(dropped);
    },
    [handleFileSelect]
  );

  /** Validates the form; surfaces issues via alerts / upload modal. Returns true only when modal can open. */
  function validateBeforeAnalysisConfirm(): boolean {
    if (!title.trim() || !datetime || !file) {
      setAlertMsg(
        "Please fill in all required fields: Meeting Title, Date & Time, and Recording."
      );
      return false;
    }
    if (!parseDatetimeLocal(datetime)) {
      setAlertMsg("Please select a valid date and time for the meeting.");
      return false;
    }
    if (!meetingType.trim()) {
      setAlertMsg("Please select a meeting type.");
      return false;
    }
    if (participants.length === 0) {
      setAlertMsg("Please add at least one participant.");
      return false;
    }
    if (!responsibleUserId) {
      setAlertMsg("Please select a responsible person for this meeting.");
      return false;
    }
    const fileIssue = getRecordingFileIssue(file, MAX_SIZE_MB);
    if (fileIssue) {
      setRecordingUploadIssue(fileIssue);
      return false;
    }
    return true;
  }

  function openAnalysisConfirmModal() {
    if (loading || !canSubmit) return;
    if (!validateBeforeAnalysisConfirm()) return;
    setConfirmAnalysisModal(true);
  }

  function openNetworkFailureModal() {
    setLoading(false);
    setUploading(false);
    setNetworkErrorModalOpen(true);
  }

  async function executeMeetingCreateAndPipeline(options?: { resume?: boolean }) {
    const resume = options?.resume === true;

    setConfirmAnalysisModal(false);
    if (!file) return;

    if (!resume) {
      pipelineCheckpointRef.current = null;
    }

    setLoading(true);
    setNetworkErrorModalOpen(false);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        router.push("/login");
        return;
      }

      if (!workspaceId) {
        setAlertMsg("No workspace selected. Please pick a workspace and try again.");
        setLoading(false);
        return;
      }

      const ridTrim = reattachMeetingId.trim();

      const ext = file.name.split(".").pop() ?? "wav";
      let meetingId: string;
      let audioPath: string;

      const useCheckpoint =
        resume && pipelineCheckpointRef.current != null ? pipelineCheckpointRef.current : null;

      if (useCheckpoint) {
        meetingId = useCheckpoint.meetingId;
        audioPath = useCheckpoint.audioPath;
      } else if (ridTrim) {
        const { data: updatedRow, error: updErr } = await (supabase as any)
          .from("meetings")
          .update({
            title: title.trim(),
            status: "uploaded",
            meeting_date: new Date(datetime).toISOString(),
            audio_file_size_bytes: file.size,
            meeting_type: meetingType.trim(),
            description: description.trim() || null,
            responsible_user_id: responsibleUserId,
            participants: participants.map((p) => p.value),
            error_message: null,
          })
          .eq("id", ridTrim)
          .eq("workspace_id", workspaceId)
          .select("id")
          .maybeSingle();

        if (updErr || !updatedRow?.id) {
          const raw =
            typeof updErr?.message === "string"
              ? updErr.message
              : updErr ? String(updErr) : "Meeting update returned no rows.";
          setLoading(false);
          if (submissionLooksLikeNetworkFailure(raw)) {
            openNetworkFailureModal();
          } else {
            setAlertMsg(`Failed to attach new recording to this meeting: ${raw}`);
          }
          return;
        }

        meetingId = ridTrim;
        audioPath = `${meetingId}/audio.${ext}`;
        pipelineCheckpointRef.current = {
          meetingId,
          audioPath,
          storageUploadDone: false,
        };
      } else {
        const { data: meetingRow, error: insertError } = await (supabase as any)
          .from("meetings")
          .insert({
            title: title.trim(),
            status: "uploaded",
            workspace_id: workspaceId,
            created_by: user.id,
            meeting_date: new Date(datetime).toISOString(),
            audio_file_size_bytes: file.size,
            meeting_type: meetingType.trim(),
            description: description.trim() || null,
            responsible_user_id: responsibleUserId,
            participants: participants.map((p) => p.value),
          })
          .select("id")
          .single();

        if (insertError || !meetingRow) {
          const raw =
            typeof insertError?.message === "string"
              ? insertError.message
              : String(insertError ?? "Unknown insert error");
          setLoading(false);
          if (submissionLooksLikeNetworkFailure(raw)) {
            openNetworkFailureModal();
          } else {
            setAlertMsg(`Failed to create meeting: ${insertError?.message ?? "Unknown error"}`);
          }
          return;
        }

        meetingId = meetingRow.id as string;
        audioPath = `${meetingId}/audio.${ext}`;
        pipelineCheckpointRef.current = {
          meetingId,
          audioPath,
          storageUploadDone: false,
        };
      }

      const ckUpload = pipelineCheckpointRef.current;
      const needUpload = !(ckUpload?.storageUploadDone);

      const wantsStorageUpsert =
        ridTrim.length > 0 ||
        Boolean(resume && ckUpload && !ckUpload.storageUploadDone);

      if (needUpload) {
        setUploading(true);
        setUploadProgress(0);

        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token ?? "";
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

        const uploadErrText = await new Promise<string | null>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `${supabaseUrl}/storage/v1/object/meetings/${audioPath}`);
          xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.setRequestHeader("x-upsert", wantsStorageUpsert ? "true" : "false");

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setUploadProgress(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(null);
            else {
              try {
                const body = JSON.parse(xhr.responseText);
                resolve(body.message ?? xhr.statusText);
              } catch {
                resolve(xhr.statusText);
              }
            }
          };
          xhr.onerror = () => resolve("Network error during upload");
          xhr.send(file);
        });

        setUploading(false);

        if (uploadErrText) {
          setLoading(false);
          const net =
            submissionLooksLikeNetworkFailure(uploadErrText) ||
            uploadErrText === "Network error during upload";
          if (net) openNetworkFailureModal();
          else setAlertMsg(`Upload failed: ${uploadErrText}`);
          return;
        }

        if (pipelineCheckpointRef.current) {
          pipelineCheckpointRef.current = {
            ...pipelineCheckpointRef.current,
            storageUploadDone: true,
          };
        }
      }

      const { data: urlData } = supabase.storage.from("meetings").getPublicUrl(audioPath);
      const { error: urlUpdateErr } = await (supabase as any)
        .from("meetings")
        .update({ audio_file_url: urlData?.publicUrl ?? audioPath })
        .eq("id", meetingId);

      if (urlUpdateErr) {
        const msg =
          typeof urlUpdateErr.message === "string"
            ? urlUpdateErr.message
            : JSON.stringify(urlUpdateErr);
        setLoading(false);
        if (submissionLooksLikeNetworkFailure(msg)) openNetworkFailureModal();
        else setAlertMsg(`Failed to save recording URL: ${msg}`);
        return;
      }

      let triggerRes: Response;
      try {
        triggerRes = await fetch("/api/trigger-pipeline", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meeting_id: meetingId,
            workspace_id: workspaceId,
            audio_path: audioPath,
          }),
        });
      } catch (e) {
        setLoading(false);
        const m = e instanceof Error ? e.message : String(e);
        if (submissionLooksLikeNetworkFailure(m, e)) openNetworkFailureModal();
        else setAlertMsg(`Pipeline trigger failed: ${m}`);
        return;
      }

      const triggerBody = (await triggerRes.json().catch(() => ({}))) as { error?: string };
      if (!triggerRes.ok) {
        setLoading(false);
        const fb =
          triggerBody.error ??
          `Pipeline trigger failed (${triggerRes.status}). Check MODAL_PIPELINE_TRIGGER_URL and MODAL_TRIGGER_SECRET.`;
        if (submissionLooksLikeNetworkFailure(fb)) openNetworkFailureModal();
        else setAlertMsg(fb);
        return;
      }

      pipelineCheckpointRef.current = null;
      setLoading(false);
      setAnalysisInitiatedOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoading(false);
      setUploading(false);
      if (submissionLooksLikeNetworkFailure(msg, err)) openNetworkFailureModal();
      else setAlertMsg(`Unexpected error: ${msg}`);
    }
  }

  function tryAgainAfterNetworkFailure() {
    void executeMeetingCreateAndPipeline({
      resume: pipelineCheckpointRef.current != null,
    });
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white">
      <DashboardHeader
        title={reattachMeetingId.trim() ? "Replace recording" : "New Meeting"}
        onBack={() => safeNavigate("/meetings")}
      />
      {reattachMeetingId.trim() ? (
        <div
          className={`border-b px-10 py-3 text-[13px] ${
            reattachLoadErr
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-amber-200 bg-amber-50 text-amber-950"
          }`}
          role="status"
        >
          {!reattachReady ? (
            <span>Loading existing meeting metadata…</span>
          ) : reattachLoadErr ? (
            <span>{reattachLoadErr}</span>
          ) : (
            <span>
              Re-upload a recording below. Saving will restart AI analysis on the same meeting ({title.trim() ? `“${title.trim()}”` : "Untitled"})
              .
            </span>
          )}
        </div>
      ) : null}

      {/* Leave confirmation — draft summary (Figma 152:13946); same when dirty back/cancel */}
      {leaveModal && (
        <LeaveMeetingDraftModal
          meetingTitle={title.trim() || "—"}
          meetingTypeLabel={meetingTypeLabelFromValue(meetingType)}
          dateTimeDisplay={formatDatetimeLocalEn(datetime) || "—"}
          description={
            description.trim()
              ? description.trim().length > 220
                ? `${description.trim().slice(0, 220)}…`
                : description.trim()
              : "—"
          }
          participantsLine={
            participants.length > 0 ? participants.map((p) => p.value).join(", ") : "—"
          }
          responsibleLabel={
            workspaceMembers.find((m) => m.user_id === responsibleUserId)?.label ?? "—"
          }
          recordingFileName={file?.name ?? "—"}
          onKeepEditing={() => setLeaveModal(false)}
          onDiscardAndLeave={confirmLeave}
        />
      )}

      {/* Ready to analysis? — Figma 142:7434 / 142:7570 */}
      {confirmAnalysisModal && (
        <AnalysisConfirmModal
          meetingTitle={title.trim()}
          meetingTypeLabel={meetingTypeLabelFromValue(meetingType)}
          dateTimeDisplay={formatDatetimeLocalEn(datetime) || "—"}
          description={
            description.trim()
              ? description.trim().length > 220
                ? `${description.trim().slice(0, 220)}…`
                : description.trim()
              : "—"
          }
          participantsLine={
            participants.length > 0 ? participants.map((p) => p.value).join(", ") : "—"
          }
          responsibleLabel={
            workspaceMembers.find((m) => m.user_id === responsibleUserId)?.label ?? "—"
          }
          recordingFileName={file?.name ?? "—"}
          onStay={() => setConfirmAnalysisModal(false)}
          onStart={() => void executeMeetingCreateAndPipeline()}
        />
      )}

      {recordingUploadIssue && (
        <RecordingUploadErrorModal
          issue={recordingUploadIssue}
          onDismiss={() => setRecordingUploadIssue(null)}
          onUploadAgain={() => {
            setRecordingUploadIssue(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
            requestAnimationFrame(() => fileInputRef.current?.click());
          }}
        />
      )}

      {/* Alert modal */}
      {alertMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl mx-4">
            <button onClick={() => setAlertMsg(null)} className="absolute right-4 top-4 text-[#94a3b8] hover:text-[#64748b]">
              <X className="h-4 w-4" />
            </button>
            <p className="text-sm leading-relaxed text-[#0a2540] text-center">{alertMsg}</p>
            <button
              onClick={() => setAlertMsg(null)}
              className="mt-5 w-full rounded-xl bg-[#0a2540] py-2.5 text-sm font-bold text-white hover:opacity-90"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Network / transport error — Figma 144:7788 */}
      {networkErrorModalOpen && (
        <NetworkSubmissionErrorModal
          onDismiss={() => setNetworkErrorModalOpen(false)}
          onTryAgain={tryAgainAfterNetworkFailure}
          tryAgainBusy={loading}
        />
      )}

      {/* Analysis started — Figma 144:7769 */}
      {analysisInitiatedOpen && (
        <AnalysisInitiatedSuccessModal
          countdownSecs={analysisCountdownSecs}
          onGoMeetingsNow={goMeetingsNow}
        />
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
        <div className="flex gap-6 p-8">
          {/* Left — Form */}
          <div className="flex flex-1 flex-col gap-6 min-w-0">
            {/* Section 1 — matches Figma S-08-01 (node 81:6644) */}
            <div className="flex max-w-[600px] flex-col gap-[15px]">
              <div className="flex items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[14px] bg-[#fff4f0] text-[14px] font-bold text-[#ff6b35]">
                  1
                </span>
                <h2 className="pb-px text-[17px] font-bold leading-none text-[#0a2540]">Meeting Information</h2>
              </div>

              <div className="flex flex-col gap-[15px]">
                <Field label="Meeting Title" required>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter meeting title"
                    required
                    className={inputCls}
                  />
                </Field>

                <Field label="Meeting Type" required>
                  <select
                    value={meetingType}
                    onChange={(e) => setMeetingType(e.target.value)}
                    required
                    className={`${inputCls} cursor-pointer appearance-none bg-[length:12px_8px] bg-[right_18px_center] bg-no-repeat pr-10`}
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%2364748b' d='M6 8 .07.59 1.43-.82 6 4.88 10.57-.81 11.93.59z'/%3E%3C/svg%3E")`,
                    }}
                  >
                    <option value="">Select meeting type</option>
                    {MEETING_TYPE_OPTIONS.map(({ value, label }) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Date & Time" required>
                  <div className="relative">
                    <input
                      type="datetime-local"
                      value={datetime}
                      onChange={(e) => setDatetime(e.target.value)}
                      required
                      aria-label="Meeting date and time"
                      lang="en-US"
                      className="peer absolute inset-0 z-10 min-h-[52px] w-full cursor-pointer opacity-0"
                    />
                    <div
                      className={`${inputCls} flex min-h-[52px] items-center peer-focus:border-[#2e5c8a] peer-focus:ring-2 peer-focus:ring-[#2e5c8a]/10`}
                    >
                      {formatDatetimeLocalEn(datetime) || "Select date and time"}
                    </div>
                  </div>
                </Field>

                <Field label="Participants" required>
                  <div ref={participantPickerRef} className="relative">
                    <button
                      type="button"
                      disabled={
                        !membersLoaded || workspaceMembers.length === 0 || participantsNotYetAdded.length === 0
                      }
                      onClick={() => setParticipantPickerOpen((o) => !o)}
                      className={`${inputCls} flex h-[52px] w-full items-center justify-between gap-2 text-left ${
                        !membersLoaded || workspaceMembers.length === 0 || participantsNotYetAdded.length === 0
                          ? "cursor-not-allowed opacity-60"
                          : "cursor-pointer"
                      }`}
                      aria-expanded={participantPickerOpen}
                      aria-haspopup="listbox"
                    >
                      <span className="truncate text-[#64748b]">
                        {!membersLoaded
                          ? "Loading workspace members…"
                          : workspaceMembers.length === 0
                            ? "No workspace members loaded"
                            : participantsNotYetAdded.length === 0
                              ? "All workspace members added"
                              : "Choose a participant…"}
                      </span>
                      <span className="shrink-0 text-[12px] text-[#94a3b8]" aria-hidden>
                        ▼
                      </span>
                    </button>
                    {participantPickerOpen && participantsNotYetAdded.length > 0 && (
                      <div
                        role="listbox"
                        className="absolute bottom-full left-0 right-0 z-30 mb-1 max-h-[min(320px,50vh)] overflow-auto rounded-xl border border-[#e2e8f0] bg-white py-1 shadow-[0_-8px_24px_rgba(10,37,64,0.12)]"
                      >
                        {participantsNotYetAdded.map((m) => {
                          const display = workspaceMemberDisplayName(m.name, m.email);
                          return (
                            <button
                              key={m.user_id}
                              type="button"
                              role="option"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => addParticipantFromMember(m)}
                              className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#f8fafc]"
                            >
                              <MemberAvatarRound
                                avatarUrl={m.avatar_url}
                                name={m.name}
                                email={m.email}
                                size={40}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-[#0a2540]">
                                  {display}
                                </span>
                                <span className="mt-0.5 block truncate text-xs text-[#64748b]">
                                  {m.email}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <p className="text-[12px] leading-[19.5px] text-[#64748b]">
                    Everyone in your workspace appears here (sorted A–Z by name).
                  </p>
                  {participants.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {participants.map((p) => {
                        const m = workspaceMembers.find(
                          (x) => x.email.toLowerCase() === p.value.toLowerCase(),
                        );
                        const chipLabel = m
                          ? workspaceMemberDisplayName(m.name, m.email)
                          : p.value;
                        return (
                          <span
                            key={p.id}
                            className="flex items-center gap-2 rounded-full border border-[#e2e8f0] bg-[#f8fafc] py-1 pl-1 pr-2 text-xs font-medium text-[#0a2540]"
                          >
                            {m ? (
                              <MemberAvatarRound
                                avatarUrl={m.avatar_url}
                                name={m.name}
                                email={m.email}
                                size={24}
                              />
                            ) : null}
                            <span className="max-w-[180px] truncate">{chipLabel}</span>
                            <button
                              type="button"
                              aria-label="Remove participant"
                              className="text-[#94a3b8] hover:text-red-500"
                              onClick={() => setParticipants((prev) => prev.filter((x) => x.id !== p.id))}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </Field>

                <Field label="Responsible person" required>
                  <select
                    value={responsibleUserId ?? ""}
                    onChange={(e) => setResponsibleUserId(e.target.value || null)}
                    required
                    disabled={!membersLoaded || workspaceMembers.length === 0}
                    className={`${inputCls} cursor-pointer appearance-none bg-[length:12px_8px] bg-[right_18px_center] bg-no-repeat pr-10`}
                    style={{
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%2364748b' d='M6 8 .07.59 1.43-.82 6 4.88 10.57-.81 11.93.59z'/%3E%3C/svg%3E")`,
                    }}
                  >
                    <option value="" disabled>
                      Select responsible person
                    </option>
                    {workspaceMembers.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[12px] leading-[19.5px] text-[#64748b]">
                    Must be a workspace member; accountable for review and publication.
                  </p>
                </Field>

                <Field label="Description (Optional)">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of the meeting agenda or topics..."
                    rows={4}
                    className={`${inputCls} min-h-[118px] resize-none py-[14px]`}
                  />
                </Field>
              </div>
            </div>

            {/* Section 2 */}
            <div className="flex max-w-[600px] flex-col gap-2 pt-2">
              <div className="flex items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[14px] bg-[#fff4f0] text-[14px] font-bold text-[#ff6b35]">
                  2
                </span>
                <h2 className="text-[18px] font-bold leading-none text-[#0a2540]">
                  Upload Recording <span className="text-[#ff6b35]">*</span>
                </h2>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={fileAcceptAttribute()}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelect(f);
                }}
              />

              {uploading ? (
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  className={`flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-[50px] py-4 text-center transition-colors ${
                    isDragging ? "border-[#ff6b35] bg-[#fff4f0]" : "border-[#cbd5e1] bg-white hover:border-[#2e5c8a]/40"
                  }`}
                >
                  <div className="flex w-full max-w-xs flex-col items-center gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#0a2540]">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
                      Uploading... {uploadProgress}%
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
                      <div
                        className="h-full rounded-full transition-all duration-200"
                        style={{
                          width: `${uploadProgress}%`,
                          background: "linear-gradient(90deg, #ff6b35 0%, #ff8555 100%)",
                        }}
                      />
                    </div>
                    <p className="text-xs text-[#94a3b8]">
                      {uploadProgress < 100
                        ? `${formatRecordingSizeMbDecimal((file!.size * uploadProgress) / 100)} / ${formatRecordingSizeMbDecimal(file!.size)}`
                        : "Processing..."}
                    </p>
                  </div>
                </div>
              ) : file ? (
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  className={isDragging ? "rounded-xl bg-[#fff4f0] p-2 ring-2 ring-[#ff6b35] ring-offset-2" : ""}
                >
                  <UploadedRecordingPreviewCard
                    file={file}
                    onRemove={() => {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  />
                </div>
              ) : (
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-[50px] py-4 text-center transition-colors ${
                    isDragging ? "border-[#ff6b35] bg-[#fff4f0]" : "border-[#cbd5e1] bg-white hover:border-[#2e5c8a]/40"
                  }`}
                >
                  <span className="text-[36px] leading-none">📁</span>
                  <div>
                    <p className="text-base font-bold text-[#0a2540]">Drag & drop your recording here</p>
                    <p className="mt-1 text-[13px] text-[#64748b]">or click to browse files</p>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg bg-[#2e5c8a] px-5 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Choose File
                  </button>
                  <p className="text-[11px] text-[#94a3b8]">
                    Supported : {allowedRecordingExtensionsLabel()} (max {MAX_SIZE_MB}MB)
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right — Info panels */}
          <div className="flex w-[360px] shrink-0 flex-col gap-5">
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-[25px]">
              <h3 className="mb-4 flex items-center gap-2 pb-px text-[15.6px] font-bold leading-none text-[#0a2540]">
                <span>✨</span> What happens next?
              </h3>
              <div className="flex flex-col gap-4">
                {STEPS.map(({ num, title: t, desc }) => (
                  <div key={num} className="flex gap-3">
                    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-xl bg-[#fff4f0] text-[12px] font-bold text-[#ff6b35]">
                      {num}
                    </span>
                    <div>
                      <p className="text-[13.6px] font-bold leading-none text-[#0a2540]">{t}</p>
                      <p className="mt-1 text-[12px] leading-[19.5px] text-[#64748b]">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#e2e8f0] bg-white p-[25px]">
              <h3 className="mb-4 flex items-center gap-2 pb-px text-[15.6px] font-bold leading-none text-[#0a2540]">
                <span className="text-xs">💡</span> Tips for best results
              </h3>
              <ul className="flex flex-col gap-0 text-[11.9px] leading-[25px] text-[#64748b]">
                {TIPS.map((tip) => (
                  <li key={tip}>• {tip}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        </div>{/* end content row + scroll area */}

        {/* Bottom bar — Cancel + Generate Notes (Figma) */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-[#e2e8f0] bg-white px-8 py-5">
          <button
            type="button"
            onClick={() => safeNavigate("/meetings")}
            className="rounded-[10px] border-2 border-[#e2e8f0] bg-white px-[26px] py-[14px] text-[15px] font-bold text-[#0f172a] transition-colors hover:bg-[#f8fafc]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={openAnalysisConfirmModal}
            disabled={loading || !canSubmit}
            title={
              !canSubmit && !loading
                ? "Fill meeting type, participants, recording, and required fields to continue."
                : undefined
            }
            className="flex h-12 items-center gap-2 rounded-[10px] px-7 text-[15px] font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.25)] transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
            style={{ background: "linear-gradient(134deg, #ff6b35 0%, #ff8555 100%)" }}
          >
            {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
            Generate Notes
          </button>
        </div>
      </div>{/* end main content */}
    </div>
  );
}

/** Figma 144:7788 — network / connection failure while submitting. */
function NetworkSubmissionErrorModal({
  onDismiss,
  onTryAgain,
  tryAgainBusy,
}: {
  onDismiss: () => void;
  onTryAgain: () => void;
  tryAgainBusy: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(10,37,64,0.6)] px-4 py-8 backdrop-blur-[2px]">
      <div
        className="relative w-full max-w-[480px] rounded-2xl bg-white p-8 pt-14 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="network-error-title"
      >
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-4 top-5 text-xl font-normal leading-none text-[#64748b] hover:text-[#0a2540]"
          aria-label="Close"
        >
          ×
        </button>

        <div className="flex flex-col items-center">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#fef2f2] text-[29px]">
            <span aria-hidden>❌</span>
          </div>

          <div className="w-full pb-px pt-3 text-center">
            <h2 id="network-error-title" className="text-2xl font-bold text-[#0a2540]">
              Check Your Connection
            </h2>
          </div>

          <div className="mt-3 w-full rounded-[10px] border border-[#fee2e2] bg-[#fef2f2] px-[17px] pb-6 pt-7">
            <div className="flex gap-1.5">
              <span className="mt-0.5 shrink-0 text-[11px] text-[#dc2626]" aria-hidden>
                ⚠️
              </span>
              <p className="text-left text-[13.6px] font-bold leading-normal text-[#dc2626]">
                We couldn&apos;t start the analysis due to a network issue.
              </p>
            </div>
            <ul className="mt-2 list-disc space-y-2 pl-[22px] text-[13.6px] leading-normal text-[#991b1b]">
              <li>Please check your internet connection.</li>
              <li>And try again in a moment.</li>
            </ul>
          </div>

          <div className="mt-3 flex w-full justify-center pt-2">
            <button
              type="button"
              disabled={tryAgainBusy}
              onClick={onTryAgain}
              className="flex h-12 w-[200px] items-center justify-center rounded-[10px] bg-[#ef4444] text-[15px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {tryAgainBusy ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                "Try Again"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Figma 144:7769 — pipeline trigger succeeded after Generate / retry. */
function AnalysisInitiatedSuccessModal({
  countdownSecs,
  onGoMeetingsNow,
}: {
  countdownSecs: number;
  onGoMeetingsNow: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(10,37,64,0.6)] px-4 py-8 backdrop-blur-[2px]">
      <div
        className="flex w-full max-w-[480px] flex-col items-center gap-3 rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-initiated-title"
      >
        <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#ff8150] text-[29px] leading-none shadow-sm">
          <span aria-hidden>⏳</span>
        </div>

        <div className="w-full pb-px pt-3 text-center">
          <h2 id="analysis-initiated-title" className="text-2xl font-bold text-[#0a2540]">
            Analysis Initiated
          </h2>
        </div>

        <p className="text-center text-[14.3px] leading-6 text-[#64748b]">
          AI is now analyzing your recording in the background!
        </p>

        <div className="w-full rounded-[10px] border border-[#94a3b8] bg-[#edf1f5] px-[17px] pb-6 pt-[14px]">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-[11px]" aria-hidden>
              ✔️
            </span>
            <span className="text-[13.6px] font-bold text-black">
              Moving you to the Home now...
            </span>
          </div>
          <ul className="list-disc space-y-2 pl-[18px] text-[12.1px] leading-[19px] text-black">
            <li className="pl-0.5">
              Analysis is running in the background — you can safely leave this page anytime.
            </li>
            <li className="pl-0.5">
              🔔 We&apos;ll notify you via ActNote alert and Gmail as soon as your analysis is
              complete. Once done, your meeting notes and action items will be ready to view.
            </li>
          </ul>
        </div>

        <div className="flex w-full justify-center pt-2">
          <button
            type="button"
            onClick={onGoMeetingsNow}
            className="flex h-12 w-[270px] items-center justify-center rounded-[10px] bg-[#ff8150] text-[15px] font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.2)] transition-opacity hover:opacity-90"
          >
            Go to Home Now ({countdownSecs}s)
          </button>
        </div>

        <p className="text-center text-[12.1px] leading-[19.5px] text-[#959faf]">
          Clicking will start the AI and redirect you to the Home screen.
        </p>
      </div>
    </div>
  );
}

interface AnalysisConfirmModalProps {
  meetingTitle: string;
  meetingTypeLabel: string;
  dateTimeDisplay: string;
  description: string;
  participantsLine: string;
  responsibleLabel: string;
  recordingFileName: string;
  onStay: () => void;
  onStart: () => void;
}

/** Figma modal — verify details before create + pipeline. */
function AnalysisConfirmModal({
  meetingTitle,
  meetingTypeLabel,
  dateTimeDisplay,
  description,
  participantsLine,
  responsibleLabel,
  recordingFileName,
  onStay,
  onStart,
}: AnalysisConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 backdrop-blur-sm">
      <div
        className="flex w-full max-w-[460px] flex-col items-center gap-3 rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="analysis-confirm-title"
      >
        <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#ff8150] text-[29px] leading-none shadow-sm">
          <span aria-hidden>🪄</span>
        </div>

        <div className="w-full pt-1 text-center">
          <h2 id="analysis-confirm-title" className="text-2xl font-bold text-[#0a2540]">
            Ready to analysis?
          </h2>
        </div>

        <p className="text-center text-[14px] leading-6 text-[#64748b]">
          Please verify your meeting details before starting AI analysis.
        </p>

        <div className="w-full rounded-[10px] border border-[#fee2e2] bg-[#edf1f5] px-[17px] py-4">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-[11px]" aria-hidden>
              ✓
            </span>
            <span className="text-[13.6px] font-bold uppercase tracking-wide text-black">
              MEETING DETAILS
            </span>
          </div>
          <ul className="list-disc space-y-1.5 pl-4 text-[12.1px] leading-[19.5px] text-[#0a2540]">
            <ConfirmRow label="Meeting title" value={meetingTitle || "—"} />
            <ConfirmRow label="Meeting type" value={meetingTypeLabel} />
            <ConfirmRow label="Date & time" value={dateTimeDisplay} />
            <ConfirmRow label="Description" value={description} />
            <ConfirmRow label="Participants" value={participantsLine} />
            <ConfirmRow label="Responsible person" value={responsibleLabel} />
            <ConfirmRow label="Recording" value={recordingFileName} />
          </ul>
        </div>

        <div className="flex w-full gap-3 pt-2 flex-col sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={onStay}
            className="h-12 w-full shrink-0 rounded-[10px] border-2 border-[#e2e8f0] bg-white text-[15px] font-bold text-[#64748b] transition-colors hover:bg-[#f8fafc] sm:max-w-[204px]"
          >
            Stay on Page
          </button>
          <button
            type="button"
            onClick={onStart}
            className="h-12 w-full shrink-0 rounded-[10px] bg-[#ff8150] text-[15px] font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.2)] transition-opacity hover:opacity-90 sm:max-w-[200px]"
          >
            Start AI Analysis
          </button>
        </div>

        <p className="text-center text-[12.1px] leading-[19.5px] text-[#959faf]">
          Clicking will start the AI and redirect you to the Home screen.
        </p>
      </div>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="break-words">
      <span className="font-medium">{label}:</span> {value || "—"}
    </li>
  );
}

/** Figma 152:13946 — show entered draft summary, confirm discard on Cancel / dirty back-nav. */
interface LeaveMeetingDraftModalProps {
  meetingTitle: string;
  meetingTypeLabel: string;
  dateTimeDisplay: string;
  description: string;
  participantsLine: string;
  responsibleLabel: string;
  recordingFileName: string;
  onKeepEditing: () => void;
  onDiscardAndLeave: () => void;
}

function LeaveMeetingDraftModal({
  meetingTitle,
  meetingTypeLabel,
  dateTimeDisplay,
  description,
  participantsLine,
  responsibleLabel,
  recordingFileName,
  onKeepEditing,
  onDiscardAndLeave,
}: LeaveMeetingDraftModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8 backdrop-blur-sm">
      <div
        className="flex w-full max-w-[460px] flex-col rounded-2xl bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-draft-title"
        aria-describedby="leave-draft-desc"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-50">
            <AlertTriangle className="h-6 w-6 text-[#ff6b35]" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="leave-draft-title" className="text-[19px] font-bold leading-snug text-[#0a2540]">
              Discard your draft?
            </h2>
            <p id="leave-draft-desc" className="mt-1.5 text-[13px] leading-relaxed text-[#64748b]">
              You&apos;ve entered meeting details below. Nothing will be saved if you leave this page.
              Still exit?
            </p>
          </div>
        </div>

        <div className="mt-6 w-full rounded-[10px] border border-[#fed7aa] bg-[#fffbeb] px-[17px] py-4">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="text-[11px]" aria-hidden>
              📋
            </span>
            <span className="text-[13.6px] font-bold uppercase tracking-wide text-[#78716c]">
              Draft you&apos;ll lose
            </span>
          </div>
          <ul className="list-disc space-y-1.5 pl-4 text-[12.1px] leading-[19.5px] text-[#0a2540]">
            <ConfirmRow label="Meeting title" value={meetingTitle || "—"} />
            <ConfirmRow label="Meeting type" value={meetingTypeLabel} />
            <ConfirmRow label="Date & time" value={dateTimeDisplay} />
            <ConfirmRow label="Description" value={description} />
            <ConfirmRow label="Participants" value={participantsLine} />
            <ConfirmRow label="Responsible person" value={responsibleLabel} />
            <ConfirmRow label="Recording" value={recordingFileName} />
          </ul>
        </div>

        <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row-reverse sm:justify-center">
          <button
            type="button"
            onClick={onDiscardAndLeave}
            className="h-12 w-full shrink-0 rounded-[10px] bg-[#ff8150] text-[15px] font-bold text-white shadow-[0px_4px_8px_rgba(255,107,53,0.2)] transition-opacity hover:opacity-90 sm:max-w-[200px]"
          >
            Discard and leave
          </button>
          <button
            type="button"
            onClick={onKeepEditing}
            className="h-12 w-full shrink-0 rounded-[10px] border-2 border-[#e2e8f0] bg-white text-[15px] font-bold text-[#64748b] transition-colors hover:bg-[#f8fafc] sm:max-w-[204px]"
          >
            Keep editing
          </button>
        </div>
      </div>
    </div>
  );
}

function meetingTypeLabelFromValue(value: string): string {
  const v = value.trim();
  if (!v) return "—";
  const opt = MEETING_TYPE_OPTIONS.find((o) => o.value === v);
  return opt?.label ?? v;
}

const STEPS = [
  { num: 1, title: "AI Processing", desc: "Your recording will be transcribed and summarized" },
  { num: 2, title: "Action Items Extracted", desc: "AI identifies tasks, assignees, and due dates" },
  { num: 3, title: "Review Draft", desc: "Edit and approve the generated notes" },
  { num: 4, title: "Owner Approval", desc: "Workspace owner reviews and approves" },
  { num: 5, title: "Publish", desc: "Share meeting notes" },
];

const TIPS = [
  "Clear audio quality improves transcription",
  "Mention names clearly for better identification",
  "Include action items explicitly in discussion",
  "Keep recording under 2 hours for optimal processing",
];

const inputCls =
  "w-full rounded-[10px] border-2 border-[#e2e8f0] bg-white px-[18px] py-[14px] text-[15px] text-[#0a2540] placeholder-[#94a3b8] outline-none transition-all focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10";
function parseDatetimeLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const dt = new Date(y, mo - 1, d, h, mi);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Pre-fill datetime-local control from Postgres timestamptz / ISO strings. */
function isoUtcToDatetimeLocalInput(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setMinutes(parsed.getMinutes() - parsed.getTimezoneOffset());
  return parsed.toISOString().slice(0, 16);
}

/** Visible label uses English AM/PM; native control stays hidden but receives clicks (OS picker may still locale). */
function formatDatetimeLocalEn(value: string): string {
  const dt = parseDatetimeLocal(value);
  if (!dt) return "";
  return dt.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-semibold text-[#0a2540]">
        {label} {required && <span className="text-[#ff6b35]">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function NewMeetingPage(): JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-3 bg-white text-[#64748b]">
          <div
            aria-hidden
            className="h-9 w-9 animate-spin rounded-full border-2 border-[#e2e8f0] border-t-[#ff6b35]"
          />
          <p className="text-[14px] font-medium">Loading form…</p>
        </div>
      }
    >
      <NewMeetingPageInner />
    </Suspense>
  );
}
