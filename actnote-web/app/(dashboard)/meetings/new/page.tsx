"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  UploadCloud, FileAudio, X, ArrowLeft,
  Calendar, Users, Tag, Layers, FileText,
  UserRound, Building2, UserPlus, Loader2,
  Bell, Mail, CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMeetings } from "@/lib/hooks/useMeetings";

const ACCEPTED_EXTS = ".wav,.mp3";
const MAX_SIZE_MB = 500;

type AttendeeType = "person" | "team" | "invite";
interface Attendee {
  id: string;
  type: AttendeeType;
  value: string;
}

interface FormFields {
  title: string;
  date: string;
  product: string;
  topic: string;
  notes: string;
}

const ATTENDEE_MODES: { type: AttendeeType; icon: React.ReactNode; label: string; placeholder: string }[] = [
  { type: "person",  icon: <UserRound className="h-4 w-4" />,  label: "사용자 성함",    placeholder: "이름 입력 후 Enter" },
  { type: "team",    icon: <Building2 className="h-4 w-4" />,  label: "팀명",           placeholder: "팀 이름 입력 후 Enter" },
  { type: "invite",  icon: <UserPlus className="h-4 w-4" />,   label: "사용자 초대하기", placeholder: "이메일 입력 후 Enter" },
];

const ATTENDEE_COLORS: Record<AttendeeType, string> = {
  person: "bg-blue-50 text-blue-700 border-blue-200",
  team:   "bg-purple-50 text-purple-700 border-purple-200",
  invite: "bg-orange-50 text-orange-700 border-orange-200",
};

export default function NewMeetingPage() {
  const router = useRouter();
  const { addMeeting } = useMeetings();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attendeeBoxRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<FormFields>({
    title: "",
    date: new Date().toISOString().split("T")[0],
    product: "",
    topic: "",
    notes: "",
  });

  // 파일
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileUploading, setFileUploading] = useState(false);

  // 참석자
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [modeInputs, setModeInputs] = useState<Record<AttendeeType, string>>({
    person: "", team: "", invite: "",
  });

  // 오류 알림 모달
  const [alertMsg, setAlertMsg] = useState<string | null>(null);

  // 처리 모달 단계: idle | processing | done
  type ModalPhase = "idle" | "processing" | "done";
  const [modalPhase, setModalPhase] = useState<ModalPhase>("idle");
  const [notifPref, setNotifPref] = useState<"push" | "email" | null>(null);
  const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 폼 제출
  const [loading, setLoading] = useState(false);

  function setField(key: keyof FormFields) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }));
  }

  // 참석자 드롭다운 외부 클릭 닫기
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (attendeeBoxRef.current && !attendeeBoxRef.current.contains(e.target as Node))
        setShowDropdown(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function addAttendee(type: AttendeeType) {
    const value = modeInputs[type].trim();
    if (!value) return;
    setAttendees((p) => [...p, { id: crypto.randomUUID(), type, value }]);
    setModeInputs((p) => ({ ...p, [type]: "" }));
  }

  function removeAttendee(id: string) {
    setAttendees((p) => p.filter((a) => a.id !== id));
  }

  // 파일 검증 + 업로드 시뮬레이션
  function handleFileSelect(f: File) {
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setAlertMsg("크기가 500MB를 초과하는 파일은 업로드 불가합니다.\n다시 선택해주세요.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (!f.name.match(/\.(wav|mp3)$/i)) {
      setAlertMsg("WAV 또는 MP3 파일만 업로드할 수 있습니다.\n다시 선택해주세요.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFileUploading(true);
    setFile(null);
    // 업로드 시뮬레이션 (1.5초)
    setTimeout(() => {
      setFile(f);
      setFileUploading(false);
      if (!form.title) setForm((p) => ({ ...p, title: f.name.replace(/\.(wav|mp3)$/i, "") }));
    }, 1500);
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFileSelect(dropped);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.title]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.date || !file) {
      setAlertMsg("필수 입력 사항을 모두 입력하세요.");
      return;
    }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));

    // "분석 중..." 상태로 저장 (created_at = 지금 시각 → 훅이 15초 후 자동으로 ready로 변경)
    const newMeeting = {
      id: crypto.randomUUID(),
      title: form.title.trim(),
      status: "transcribing" as const,
      created_at: new Date().toISOString(),
      summary: form.topic.trim() || null,
      audio_url: null,
      filename: file.name,
      workspace_id: "local",
    };
    addMeeting(newMeeting);
    setLoading(false);
    setModalPhase("processing");

    // 15초 후 모달이 아직 열려있으면 완료 알림으로 전환
    processingTimerRef.current = setTimeout(() => {
      setModalPhase((phase) => (phase === "processing" ? "done" : phase));
    }, 15_000);
  }

  function handleNotifSelect(pref: "push" | "email") {
    setNotifPref(pref);
    // 알림 선택 후 모달 닫고 목록으로
    closeModalAndNavigate();
  }

  function closeModalAndNavigate() {
    if (processingTimerRef.current) clearTimeout(processingTimerRef.current);
    setModalPhase("idle");
    router.push("/meetings");
  }

  return (
    <div className="max-w-2xl">
      {/* 오류 알림 모달 */}
      {alertMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-white p-6 shadow-xl mx-4">
            <p className="text-sm leading-relaxed whitespace-pre-line text-center text-foreground">
              {alertMsg}
            </p>
            <button
              onClick={() => setAlertMsg(null)}
              className="mt-5 w-full rounded-lg bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* AI 처리 중 모달 */}
      {modalPhase === "processing" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-2xl border border-border bg-white p-7 shadow-xl mx-4">
            {/* X 닫기 */}
            <button
              onClick={closeModalAndNavigate}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>

            <p className="text-xs font-semibold text-muted-foreground mb-5">안내</p>

            {/* 처리 중 배너 */}
            <div className="flex items-center gap-3 rounded-xl bg-muted/60 px-4 py-3 mb-5">
              <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
              <span className="text-sm font-medium">화자 분리 STT 처리중...</span>
            </div>

            <p className="text-sm text-center text-foreground font-medium mb-1">
              예상 시간은 약 5분입니다.
            </p>
            <p className="text-xs text-center text-muted-foreground mb-7">
              창을 닫으셔도 분석이 중단되지 않아요.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleNotifSelect("push")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-all",
                  notifPref === "push"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-white hover:border-primary/50 hover:bg-muted/40"
                )}
              >
                <Bell className="h-4 w-4" />
                push 알림
              </button>
              <button
                onClick={() => handleNotifSelect("email")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-all",
                  notifPref === "email"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-white hover:border-primary/50 hover:bg-muted/40"
                )}
              >
                <Mail className="h-4 w-4" />
                메일로 알림
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 분석 완료 모달 */}
      {modalPhase === "done" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-2xl border border-border bg-white p-7 shadow-xl mx-4">
            <button
              onClick={closeModalAndNavigate}
              className="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </button>

            <p className="text-xs font-semibold text-muted-foreground mb-5">안내</p>

            {/* 완료 배너 */}
            <div className="flex items-center gap-3 rounded-xl bg-green-50 border border-green-200 px-4 py-3 mb-5">
              <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
              <span className="text-sm font-semibold text-green-700">AI 분석 완료</span>
            </div>

            <p className="text-sm text-center text-foreground mb-6">
              분석이 완료됐습니다.
            </p>

            <button
              onClick={closeModalAndNavigate}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-border bg-white py-3 text-sm font-semibold hover:bg-muted/40 transition-colors"
            >
              <CheckCircle className="h-4 w-4 text-green-600" />
              확인 하기
            </button>
          </div>
        </div>
      )}

      <Link
        href="/meetings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        목록으로
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">새 회의</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          회의 정보를 입력하고 녹음 파일을 업로드하면 AI가 자동으로 처리합니다.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 기본 정보 */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">기본 정보</h2>

          <Field icon={<FileText className="h-4 w-4" />} label="회의명" required>
            <input type="text" value={form.title} onChange={setField("title")}
              placeholder="예: 주간 PRD 회의" className={inputCls} />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field icon={<Calendar className="h-4 w-4" />} label="날짜" required>
              <input type="date" value={form.date} onChange={setField("date")} className={inputCls} />
            </Field>
            <Field icon={<Layers className="h-4 w-4" />} label="프로덕트 / 프로젝트">
              <input type="text" value={form.product} onChange={setField("product")}
                placeholder="예: ACTNOTE, 앱 리뉴얼" className={inputCls} />
            </Field>
          </div>

          <Field icon={<Tag className="h-4 w-4" />} label="주제">
            <input type="text" value={form.topic} onChange={setField("topic")}
              placeholder="예: 스프린트 회고, Q2 목표 설정" className={inputCls} />
          </Field>

          {/* 참석자 */}
          <Field icon={<Users className="h-4 w-4" />} label="참석자">
            <div ref={attendeeBoxRef} className="relative">
              {/* 태그 + 검색 인풋 */}
              <div
                onClick={() => setShowDropdown(true)}
                className={cn(
                  "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm cursor-text",
                  showDropdown && "ring-1 ring-ring"
                )}
              >
                {attendees.map((a) => (
                  <span
                    key={a.id}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                      ATTENDEE_COLORS[a.type]
                    )}
                  >
                    {a.value}
                    <button type="button" onClick={(e) => { e.stopPropagation(); removeAttendee(a.id); }}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {attendees.length === 0 && !showDropdown && (
                  <span className="text-muted-foreground">사용자나 팀을 검색하세요.</span>
                )}
              </div>

              {/* 드롭다운 */}
              {showDropdown && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-border bg-white shadow-lg overflow-hidden">
                  {ATTENDEE_MODES.map((mode) => (
                    <div key={mode.type} className="px-4 py-3 border-b border-border/60 last:border-b-0">
                      <div className="flex items-center gap-2 mb-2 text-xs font-medium text-muted-foreground">
                        {mode.icon}
                        {mode.label}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type={mode.type === "invite" ? "email" : "text"}
                          value={modeInputs[mode.type]}
                          onChange={(e) =>
                            setModeInputs((p) => ({ ...p, [mode.type]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); addAttendee(mode.type); }
                          }}
                          placeholder={mode.placeholder}
                          className="flex-1 h-8 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <button
                          type="button"
                          onClick={() => addAttendee(mode.type)}
                          className="h-8 px-3 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                        >
                          추가
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Field>
        </div>

        {/* 녹음 파일 */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            녹음 파일 <span className="text-brand-accent ml-0.5">*</span>
          </h2>
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => !file && !fileUploading && fileInputRef.current?.click()}
            className={cn(
              "flex flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 text-center transition-colors",
              isDragging ? "border-primary bg-primary/5 cursor-copy"
                : fileUploading ? "border-border bg-muted/20 cursor-default"
                : file ? "border-green-300 bg-green-50 cursor-default"
                : "border-border hover:border-primary/40 hover:bg-muted/30 cursor-pointer"
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTS}
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
            />

            {fileUploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm font-medium text-muted-foreground">업로드 중...</p>
              </div>
            ) : file ? (
              <div className="flex items-center gap-3 px-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-600">
                  <FileAudio className="h-4 w-4" />
                </div>
                <div className="text-left flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            ) : (
              <>
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <UploadCloud className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium">드래그하거나 클릭해서 업로드</p>
                <p className="mt-1 text-xs text-muted-foreground">WAV, MP3 · 최대 500MB</p>
              </>
            )}
          </div>
        </div>

        {/* 추가사항 */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            추가사항 <span className="text-xs font-normal normal-case">(선택)</span>
          </h2>
          <textarea
            value={form.notes}
            onChange={setField("notes")}
            rows={3}
            placeholder={"AI에게 전달할 추가 컨텍스트를 입력하세요.\n예: 이번 회의는 기술 부채 논의 위주였음"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Link
            href="/meetings"
            className="inline-flex items-center justify-center rounded-lg border border-border px-5 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
          >
            취소
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" />처리 중...</>
            ) : "처리 시작"}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function Field({
  icon, label, required, children,
}: {
  icon: React.ReactNode;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        <span className="text-muted-foreground">{icon}</span>
        {label}
        {required && <span className="text-brand-accent">*</span>}
      </label>
      {children}
    </div>
  );
}
