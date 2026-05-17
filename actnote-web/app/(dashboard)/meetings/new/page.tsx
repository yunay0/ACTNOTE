"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { X, AlertTriangle } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { createClient } from "@/lib/supabase/client";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import {
  allowedRecordingExtensionsLabel,
  fileAcceptAttribute,
  validateRecordingFileName,
} from "@/lib/meeting/recordingFilename";

const MAX_SIZE_MB = 50;

interface Participant { id: string; value: string; }

export default function NewMeetingPage() {
  const router = useRouter();
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
  const [participantInput, setParticipantInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [processingModal, setProcessingModal] = useState(false);
  const [doneModal, setDoneModal] = useState(false);
  const [leaveModal, setLeaveModal] = useState(false);
  const [pendingNavTarget, setPendingNavTarget] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [memberOptions, setMemberOptions] = useState<{ user_id: string; label: string }[]>([]);
  const [responsibleUserId, setResponsibleUserId] = useState<string | null>(null);
  const [membersLoaded, setMembersLoaded] = useState(false);

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
    title,
    datetime,
    file,
    meetingType,
    participants.length,
    responsibleUserId,
  ]);

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
      setMemberOptions([]);
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

      const { data: rows, error } = await (supabase as any)
        .from("workspace_members")
        .select("user_id, users(name, email)")
        .eq("workspace_id", workspaceId);

      if (cancelled) return;

      if (error || !rows?.length) {
        setMemberOptions([
          { user_id: user.id, label: user.email ?? "You (organizer)" },
        ]);
        setResponsibleUserId(user.id);
        setMembersLoaded(true);
        return;
      }

      const opts = (rows as any[]).map((r) => {
        const u = Array.isArray(r.users) ? r.users[0] : r.users;
        const name = typeof u?.name === "string" ? u.name.trim() : "";
        const email = typeof u?.email === "string" ? u.email : "";
        const label = name ? `${name} (${email})` : email || String(r.user_id);
        return { user_id: r.user_id as string, label };
      });
      setMemberOptions(opts);
      setResponsibleUserId((prev) =>
        prev && opts.some((o) => o.user_id === prev) ? prev : user.id
      );
      setMembersLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // 헤더 백버튼 대신 사용할 safe navigate
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
    if (pendingNavTarget) router.push(pendingNavTarget);
  }

  function addParticipant() {
    const val = participantInput.trim();
    if (!val) return;
    setParticipants((p) => [...p, { id: crypto.randomUUID(), value: val }]);
    setParticipantInput("");
  }

  function handleFileSelect(f: File) {
    const nameErr = validateRecordingFileName(f.name);
    if (nameErr) {
      setAlertMsg(nameErr);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setAlertMsg(`File size exceeds ${MAX_SIZE_MB}MB limit. Please choose a smaller file.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.(mp3|m4a|wav|mp4|mov)$/i, ""));
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  async function handleSubmit() {
    if (!title.trim() || !datetime || !file) {
      setAlertMsg("Please fill in all required fields: Meeting Title, Date & Time, and Recording.");
      return;
    }
    if (!meetingType.trim()) {
      setAlertMsg("Please select a meeting type.");
      return;
    }
    if (participants.length === 0) {
      setAlertMsg("Please add at least one participant.");
      return;
    }
    if (!responsibleUserId) {
      setAlertMsg("Please select a responsible person for this meeting.");
      return;
    }
    const nameErrSubmit = validateRecordingFileName(file.name);
    if (nameErrSubmit) {
      setAlertMsg(nameErrSubmit);
      return;
    }
    setLoading(true);

    try {
      const supabase = createClient();

      // 유저 확인
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      if (!workspaceId) {
        setAlertMsg("No workspace selected. Please pick a workspace and try again.");
        setLoading(false);
        return;
      }

      // 1. meetings 테이블에 row 먼저 삽입 (ID 확보)
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
        setAlertMsg(`Failed to create meeting: ${insertError?.message}`);
        setLoading(false);
        return;
      }

      const meetingId = meetingRow.id as string;

      // 2. Storage에 파일 업로드 (경로: {meeting_id}/audio.{ext})
      const ext = file.name.split(".").pop() ?? "wav";
      const audioPath = `${meetingId}/audio.${ext}`;
      setUploading(true);
      setUploadProgress(0);

      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? "";
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

      const uploadError = await new Promise<string | null>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${supabaseUrl}/storage/v1/object/meetings/${audioPath}`);
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.setRequestHeader("x-upsert", "false");

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

      if (uploadError) {
        setAlertMsg(`Upload failed: ${uploadError}`);
        setLoading(false);
        return;
      }

      // 3. audio_file_url 업데이트
      const { data: urlData } = supabase.storage.from("meetings").getPublicUrl(audioPath);
      await (supabase as any)
        .from("meetings")
        .update({ audio_file_url: urlData?.publicUrl ?? audioPath })
        .eq("id", meetingId);

      // 4. Inngest 이벤트 발송 → 백엔드 파이프라인 트리거
      const triggerRes = await fetch("/api/trigger-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meeting_id: meetingId,
          workspace_id: workspaceId,
          audio_path: audioPath,
        }),
      });
      const triggerBody = (await triggerRes.json().catch(() => ({}))) as { error?: string };
      if (!triggerRes.ok) {
        setAlertMsg(
          triggerBody.error ??
            `Pipeline trigger failed (${triggerRes.status}). Check INNGEST_EVENT_KEY and Inngest app id.`
        );
        setLoading(false);
        return;
      }

      setLoading(false);
      setProcessingModal(true);
      timerRef.current = setTimeout(() => {
        setProcessingModal(false);
        setDoneModal(true);
      }, 15_000);

    } catch (err) {
      setAlertMsg(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  }

  function closeAndGo() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setProcessingModal(false);
    setDoneModal(false);
    router.push("/meetings");
  }

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DashboardHeader title="New Meeting" onBack={() => safeNavigate("/meetings")} />

      {/* Leave confirmation modal */}
      {leaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl mx-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-50">
                <AlertTriangle className="h-5 w-5 text-[#ff6b35]" />
              </div>
              <div>
                <p className="text-[15px] font-bold text-[#0a2540]">Leave this page?</p>
                <p className="text-[13px] text-[#64748b]">All entered content will be lost.</p>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => setLeaveModal(false)}
                className="flex-1 h-11 rounded-xl border-2 border-[#e2e8f0] text-[14px] font-bold text-[#64748b] hover:bg-[#f8fafc] transition-colors"
              >
                Keep Editing
              </button>
              <button
                onClick={confirmLeave}
                className="flex-1 h-11 rounded-xl text-[14px] font-bold text-white hover:opacity-90 transition-opacity"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
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

      {/* Processing modal */}
      {processingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl mx-4">
            <button onClick={closeAndGo} className="absolute right-4 top-4 text-[#94a3b8] hover:text-[#64748b]">
              <X className="h-4 w-4" />
            </button>
            <p className="mb-5 text-xs font-semibold text-[#94a3b8]">Notice</p>
            <div className="mb-5 flex items-center gap-3 rounded-xl bg-[#f8fafc] px-4 py-3">
              <span className="animate-spin text-lg">⏳</span>
              <span className="text-sm font-semibold text-[#0a2540]">AI is processing your recording...</span>
            </div>
            <p className="mb-1 text-center text-sm font-medium text-[#0a2540]">Estimated time: ~5 minutes</p>
            <p className="mb-7 text-center text-xs text-[#64748b]">You can close this window — processing will continue.</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={closeAndGo}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-[#e2e8f0] py-3 text-sm font-semibold text-[#0a2540] hover:border-[#2e5c8a] hover:bg-[#f8fafc] transition-all"
              >
                🔔 Push notification
              </button>
              <button
                onClick={closeAndGo}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-[#e2e8f0] py-3 text-sm font-semibold text-[#0a2540] hover:border-[#2e5c8a] hover:bg-[#f8fafc] transition-all"
              >
                ✉️ Email me
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Done modal */}
      {doneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-7 shadow-xl mx-4">
            <button onClick={closeAndGo} className="absolute right-4 top-4 text-[#94a3b8] hover:text-[#64748b]">
              <X className="h-4 w-4" />
            </button>
            <p className="mb-5 text-xs font-semibold text-[#94a3b8]">Notice</p>
            <div className="mb-5 flex items-center gap-3 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
              <span className="text-lg">✅</span>
              <span className="text-sm font-semibold text-green-700">AI Analysis Complete</span>
            </div>
            <p className="mb-6 text-center text-sm text-[#0a2540]">Your meeting notes are ready.</p>
            <button
              onClick={closeAndGo}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-[#e2e8f0] py-3 text-sm font-semibold text-[#0a2540] hover:bg-[#f8fafc] transition-colors"
            >
              ✅ View Results
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
        <div className="flex gap-6 p-8">
          {/* Left — Form */}
          <div className="flex flex-1 flex-col gap-6 min-w-0">
            {/* Section 1 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff6b35] text-xs font-bold text-white">1</span>
                <h2 className="text-[16px] font-bold text-[#0a2540]">Meeting Information</h2>
              </div>
              <p className="mb-4 text-[12px] leading-snug text-[#64748b]">
                <span className="font-semibold text-[#ff6b35]">*</span> Fields are required before{" "}
                <span className="font-semibold text-[#0a2540]">Generate Notes</span> is enabled. Add your recording in section 2.
              </p>

              <div className="flex flex-col gap-4">
                <Field label="Meeting Title" required>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Product Roadmap Q2 Review"
                    className={inputCls}
                  />
                </Field>

                <Field label="Meeting Type" required>
                  <select
                    value={meetingType}
                    onChange={(e) => setMeetingType(e.target.value)}
                    className={`${inputCls} cursor-pointer`}
                  >
                    <option value="">Select meeting type...</option>
                    {MEETING_TYPES.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  {meetingType && MEETING_TYPE_HINTS[meetingType] && (
                    <p className="text-[12px] text-[#64748b] mt-1 flex items-start gap-1">
                      <span className="text-[#ff6b35] mt-px">✦</span>
                      {MEETING_TYPE_HINTS[meetingType]}
                    </p>
                  )}
                </Field>

                <Field label="Date & Time" required>
                  <input
                    type="datetime-local"
                    value={datetime}
                    onChange={(e) => setDatetime(e.target.value)}
                    className={inputCls}
                  />
                </Field>

                <Field label="Description (Optional)">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of the meeting agenda or topics..."
                    rows={3}
                    className={`${inputCls} resize-none`}
                  />
                </Field>

                <Field label="Participants" required>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={participantInput}
                      onChange={(e) => setParticipantInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addParticipant())}
                      placeholder="Enter name or email"
                      className={`${inputCls} flex-1`}
                    />
                    <button
                      type="button"
                      onClick={addParticipant}
                      className="h-11 rounded-xl bg-[#0a2540] px-4 text-sm font-bold text-white hover:opacity-90 transition-opacity"
                    >
                      Add
                    </button>
                  </div>
                  {participants.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {participants.map((p) => (
                        <span key={p.id} className="flex items-center gap-1 rounded-full bg-[#e3f2fd] px-3 py-1 text-xs font-medium text-[#2e5c8a]">
                          {p.value}
                          <button onClick={() => setParticipants((prev) => prev.filter((x) => x.id !== p.id))}>
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {participants.length === 0 && (
                    <p className="text-[11px] text-[#94a3b8]">At least one participant is required.</p>
                  )}
                  {participants.length > 0 && (
                    <p className="mt-1 text-xs text-[#94a3b8]">Add team members who attended this meeting</p>
                  )}
                </Field>

                <Field label="Responsible person" required>
                  <select
                    value={responsibleUserId ?? ""}
                    onChange={(e) => setResponsibleUserId(e.target.value || null)}
                    disabled={!membersLoaded}
                    className={`${inputCls} cursor-pointer disabled:opacity-60`}
                  >
                    {memberOptions.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  {!membersLoaded && (
                    <p className="text-[12px] text-[#94a3b8]">Loading workspace members…</p>
                  )}
                </Field>
              </div>
            </div>

            {/* Section 2 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-6">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff6b35] text-xs font-bold text-white">2</span>
                <h2 className="text-[16px] font-bold text-[#0a2540]">Upload Recording <span className="text-[#ff6b35]">*</span></h2>
              </div>

              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
                  isDragging ? "border-[#ff6b35] bg-[#fff4f0]" : "border-[#e2e8f0] bg-[#f8fafc] hover:border-[#2e5c8a]/40"
                }`}
              >
                <input ref={fileInputRef} type="file" accept={fileAcceptAttribute()} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />

                {uploading ? (
                  <div className="flex flex-col items-center gap-3 w-full max-w-xs">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[#0a2540]">
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
                      Uploading... {uploadProgress}%
                    </div>
                    <div className="w-full h-2 rounded-full bg-[#e2e8f0] overflow-hidden">
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
                        ? `${(file!.size * uploadProgress / 100 / 1024 / 1024).toFixed(1)} MB / ${(file!.size / 1024 / 1024).toFixed(1)} MB`
                        : "Processing..."}
                    </p>
                  </div>
                ) : file ? (
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl">🎵</span>
                    <p className="text-sm font-semibold text-[#0a2540]">{file.name}</p>
                    <p className="text-xs text-[#94a3b8]">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                ) : (
                  <>
                    <span className="text-4xl">🗂️</span>
                    <div>
                      <p className="text-sm font-semibold text-[#0a2540]">Drag & drop your recording here</p>
                      <p className="text-xs text-[#64748b]">or click to browse files</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg bg-[#0a2540] px-5 py-2 text-sm font-bold text-white hover:opacity-90 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    >
                      Choose File
                    </button>
                    <p className="text-xs text-[#94a3b8]">Supported: {allowedRecordingExtensionsLabel()} (max {MAX_SIZE_MB}MB)</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right — Info panels */}
          <div className="w-[300px] shrink-0 flex flex-col gap-4">
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
              <h3 className="mb-4 flex items-center gap-2 text-[14px] font-bold text-[#0a2540]">
                <span className="text-[#ff6b35]">✦</span> What happens next?
              </h3>
              <div className="flex flex-col gap-3">
                {STEPS.map(({ num, title: t, desc }) => (
                  <div key={num} className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ff6b35] text-[11px] font-bold text-white mt-0.5">{num}</span>
                    <div>
                      <p className="text-[13px] font-bold text-[#0a2540]">{t}</p>
                      <p className="text-[12px] text-[#64748b]">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
              <h3 className="mb-4 flex items-center gap-2 text-[14px] font-bold text-[#0a2540]">
                <span>⚡</span> Tips for best results
              </h3>
              <ul className="flex flex-col gap-2">
                {TIPS.map((tip) => (
                  <li key={tip} className="flex items-start gap-1.5 text-[12px] text-[#64748b]">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#94a3b8]" />
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        </div>{/* end content row + scroll area */}

        {/* Bottom bar — Generate Notes */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-[#e2e8f0] bg-white px-8 py-4">
          {!canSubmit && !loading ? (
            <p className="text-[12px] text-[#64748b] max-w-xl">
              Complete all <span className="text-[#ff6b35] font-semibold">*</span> fields in section 1 and attach a recording in section 2.
            </p>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !canSubmit}
            title={
              !canSubmit && !loading
                ? "Fill meeting type, participants, recording, and required fields to continue."
                : undefined
            }
            className="flex h-11 items-center gap-2 rounded-[10px] px-8 text-[15px] font-bold text-white shadow-[0px_4px_6px_rgba(255,107,53,0.2)] hover:opacity-90 disabled:opacity-50 disabled:pointer-events-none transition-opacity"
            style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
          >
            {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
            Generate Notes
          </button>
        </div>
      </div>{/* end main content */}
    </div>
  );
}

const STEPS = [
  { num: 1, title: "AI Processing", desc: "Your recording will be transcribed and summarized" },
  { num: 2, title: "Action Items Extracted", desc: "AI identifies tasks, assignees, and due dates" },
  { num: 3, title: "Review Draft", desc: "Edit and approve the generated notes" },
  { num: 4, title: "Publish", desc: "Share meeting notes" },
];

const TIPS = [
  "Clear audio quality improves transcription",
  "Mention names clearly for better identification",
  "Include action items explicitly in discussion",
  "Keep recording under 2 hours for optimal processing",
];

const inputCls =
  "h-11 w-full rounded-xl border border-[#e2e8f0] bg-white px-4 text-sm text-[#0a2540] placeholder-[#94a3b8] outline-none transition-all focus:border-[#2e5c8a] focus:ring-2 focus:ring-[#2e5c8a]/10";

// MTG-004: 회의 유형 템플릿
// 백엔드 스펙: 'default' | 'sprint' | 'planning' | 'retro' | '1on1'
const MEETING_TYPES = [
  { value: "default",  label: "General Meeting" },
  { value: "sprint",   label: "Sprint" },
  { value: "planning", label: "Planning" },
  { value: "retro",    label: "Retrospective" },
  { value: "1on1",     label: "1:1" },
];

const MEETING_TYPE_HINTS: Record<string, string> = {
  default:  "AI will extract general action items, decisions, and key discussion points.",
  sprint:   "AI will focus on task assignments, story points, sprint goals, and blockers.",
  planning: "AI will extract goals, timelines, owners, milestones, and key decisions.",
  retro:    "AI will identify what went well, what didn't, and action items for improvement.",
  "1on1":   "AI will focus on personal goals, blockers, feedback, and follow-up actions.",
};

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
