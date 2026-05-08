"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarDays, CheckCircle2, ListTodo, Sparkles } from "lucide-react";
import { useMeetings } from "@/lib/hooks/useMeetings";
import { StatusBadge } from "@/components/meetings/StatusBadge";
import { ProcessingProgress } from "@/components/meetings/ProcessingProgress";
import type { Meeting } from "@/lib/types/meeting";

export default function MeetingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { getMeeting, hydrated } = useMeetings();
  const [meeting, setMeeting] = useState<Meeting | undefined>(undefined);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    const found = getMeeting(id);
    if (found) {
      setMeeting(found);
    } else {
      setNotFound(true);
    }
  }, [id, hydrated, getMeeting]);

  if (!hydrated) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="h-8 w-48 rounded-lg bg-muted animate-pulse" />
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-lg font-semibold text-foreground">회의를 찾을 수 없습니다</p>
        <p className="mt-1 text-sm text-muted-foreground">삭제되었거나 존재하지 않는 회의입니다.</p>
        <Link
          href="/meetings"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 목록으로
        </Link>
      </div>
    );
  }

  if (!meeting) return null;

  const date = new Date(meeting.created_at).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const isReady = meeting.status === "ready";

  return (
    <div className="max-w-3xl space-y-6">
      {/* 뒤로가기 */}
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> 목록으로
      </button>

      {/* 헤더 */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-3">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-bold leading-snug">{meeting.title}</h1>
          <StatusBadge status={meeting.status} className="shrink-0 mt-0.5" />
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" />
          {date}
        </div>

        {/* 처리 중일 때 진행 상황 표시 */}
        {!isReady && <ProcessingProgress status={meeting.status} />}
      </div>

      {isReady && (
        <>
          {/* 요약 */}
          <Section icon={<Sparkles className="h-4 w-4 text-brand-accent" />} title="AI 요약">
            {meeting.summary ? (
              <p className="text-sm leading-relaxed text-foreground">{meeting.summary}</p>
            ) : (
              <EmptyNote text="요약이 없습니다. 실제 파이프라인 연결 후 자동 생성됩니다." />
            )}
          </Section>

          {/* 결정사항 */}
          <Section icon={<CheckCircle2 className="h-4 w-4 text-primary" />} title="결정사항">
            <EmptyNote text="결정사항이 없습니다. 실제 파이프라인 연결 후 자동 추출됩니다." />
          </Section>

          {/* 액션 아이템 */}
          <Section icon={<ListTodo className="h-4 w-4 text-primary" />} title="액션 아이템">
            <EmptyNote text="액션 아이템이 없습니다. 실제 파이프라인 연결 후 자동 추출됩니다." />
          </Section>
        </>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <p className="text-sm text-muted-foreground italic">{text}</p>
  );
}
