"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X, AlertTriangle } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { createClient } from "@/lib/supabase/client";

const MAX_SIZE_MB = 50;
const ACCEPTED = ".mp3,.m4a,.wav,.mp4,.mov";

interface Participant { id: string; value: string; }

export default function NewMeetingPage() {
  const router = useRouter();
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
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [processingModal, setProcessingModal] = useState(false);
  const [doneModal, setDoneModal] = useState(false);
  const [leaveModal, setLeaveModal] = useState(false);
  const [pendingNavTarget, setPendingNavTarget] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 폼에 입력값이 하나라도 있으면 dirty
  const isDirty = title.trim() !== "" || meetingType.trim() !== "" ||
    description.trim() !== "" || participants.length > 0 || file !== null;

  // 브라우저 새로고침 / 탭 닫기 방지
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirty) return;
      e.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

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
    setLoading(true);

    try {
      const supabase = createClient();

      // 유저 확인
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      // 워크스페이스 조회
      const { data: ws, error: wsError } = await (supabase as any)
        .from("workspaces")
        .select("id")
        .eq("owner_id", user.id)
        .single();
      if (wsError || !ws) {
        setAlertMsg("Workspace not found. Please refresh and try again.");
        setLoading(false);
        return;
      }

      // 미팅 ID 생성 후 Storage에 파일 업로드
      const meetingId = crypto.randomUUID();
      const filePath = `${ws.id}/${meetingId}/${file.name}`;
      setUploading(true);

      const { error: uploadError } = await supabase.storage
        .from("meetings")
        .upload(filePath, file, { upsert: false });

      setUploading(false);

      if (uploadError) {
        setAlertMsg(`Upload failed: ${uploadError.message}`);
        setLoading(false);
        return;
      }

      // 파일 경로 저장 (공개 URL 또는 경로)
      const { data: urlData } = supabase.storage.from("meetings").getPublicUrl(filePath);
      const audioFileUrl = urlData?.publicUrl ?? filePath;

      // meetings 테이블에 row 삽입
      const { error: insertError } = await (supabase as any)
        .from("meetings")
        .insert({
          id: meetingId,
          title: title.trim(),
          status: "uploaded",
          workspace_id: ws.id,
          created_by: user.id,
          meeting_date: new Date(datetime).toISOString(),
          audio_file_url: audioFileUrl,
          audio_file_size_bytes: file.size,
        });

      if (insertError) {
        setAlertMsg(`Failed to create meeting: ${insertError.message}`);
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
                  <input
                    type="text"
                    value={meetingType}
                    onChange={(e) => setMeetingType(e.target.value)}
                    placeholder="e.g. Team Sync, Planning, Review"
                    className={inputCls}
                  />
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
                  {participants.length > 0 && (
                    <p className="mt-1 text-xs text-[#94a3b8]">Add team members who attended this meeting</p>
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
                <input ref={fileInputRef} type="file" accept={ACCEPTED} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />

                {uploading ? (
                  <div className="flex flex-col items-center gap-2">
                    <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
                    <p className="text-sm font-medium text-[#64748b]">Uploading to cloud...</p>
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
                    <p className="text-xs text-[#94a3b8]">Supported: MP3, M4A, WAV, MP4, MOV (max 50MB)</p>
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
        <div className="shrink-0 flex items-center justify-end border-t border-[#e2e8f0] bg-white px-8 py-4">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex h-11 items-center gap-2 rounded-[10px] px-8 text-[15px] font-bold text-white shadow-[0px_4px_6px_rgba(255,107,53,0.2)] hover:opacity-90 disabled:opacity-60 transition-opacity"
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
