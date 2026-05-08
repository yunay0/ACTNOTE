import Link from "next/link";
import { ArrowRight, Mic, Zap, GitBranch } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <LandingNav />
      <main className="flex-1">
        <HeroSection />
        <FeaturesSection />
        <CtaSection />
      </main>
      <LandingFooter />
    </div>
  );
}

function LandingNav() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-sm">
      <div className="container flex h-14 items-center justify-between">
        <span className="font-bold text-lg tracking-tight text-primary">
          ACTNOTE
        </span>
        <nav className="flex items-center gap-2">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-md hover:bg-accent"
          >
            로그인/회원가입
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-accent px-4 py-1.5 text-sm font-semibold text-brand-accent-foreground shadow-sm hover:bg-brand-accent/90 transition-colors"
          >
            시작하기
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </nav>
      </div>
    </header>
  );
}

function HeroSection() {
  return (
    <section className="relative flex flex-col items-center justify-center px-4 py-28 md:py-40 text-center overflow-hidden">
      {/* 배경 그라디언트 (Deep Blue) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,hsl(225_64%_33%/0.10),transparent)]"
      />

      <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground mb-8">
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-accent opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-accent" />
        </span>
        AI 기반 회의 분석
      </div>

      <h1 className="text-5xl font-extrabold tracking-tight text-primary md:text-7xl lg:text-8xl">
        ACTNOTE
      </h1>
      <p className="mt-4 text-xl font-medium text-muted-foreground md:text-2xl">
        AI 회의록 트래커
      </p>
      <p className="mt-6 max-w-xl text-base text-muted-foreground leading-relaxed">
        회의 음성을 업로드하면 AI가 자동으로 요약·결정사항·액션 아이템을 추출합니다.
        변경 이력까지 시간순으로 추적하세요.
      </p>

      <div className="mt-10 flex flex-col sm:flex-row items-center gap-3">
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-accent px-6 py-3 text-sm font-semibold text-brand-accent-foreground shadow hover:bg-brand-accent/90 transition-colors"
        >
          시작하기
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-6 py-3 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          로그인/회원가입
        </Link>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: Mic,
    title: "자동 음성 변환",
    description:
      "회의 녹음 파일을 업로드하면 STT와 화자 분리까지 자동으로 처리합니다.",
  },
  {
    icon: Zap,
    title: "A.U.D.N 사이클",
    description:
      "LLM이 액션 아이템을 ADD / UPDATE / DELETE / NOOP으로 자동 분류해 중복과 누락을 제거합니다.",
  },
  {
    icon: GitBranch,
    title: "Bi-temporal 이력",
    description:
      "결정사항과 액션 아이템의 변경 이력을 타임라인으로 추적합니다. 언제 무엇이 바뀌었는지 한눈에.",
  },
] as const;

function FeaturesSection() {
  return (
    <section className="px-4 py-20 md:py-28 bg-muted/30">
      <div className="container">
        <div className="mx-auto mb-14 max-w-xl text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            회의에서 액션까지, 자동으로
          </h2>
          <p className="mt-3 text-muted-foreground">
            반복적인 회의록 정리에서 벗어나 실행에 집중하세요.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="group rounded-xl border border-border/60 bg-card p-6 shadow-sm hover:border-primary/30 hover:shadow-md transition-all"
            >
              <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="px-4 py-20 md:py-28">
      <div className="container">
        <div className="relative mx-auto max-w-2xl rounded-2xl border border-primary/20 bg-primary px-8 py-14 text-center overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_50%_110%,hsl(225_64%_50%/0.3),transparent)]"
          />
          <h2 className="text-3xl font-bold tracking-tight text-primary-foreground">
            지금 바로 시작하세요
          </h2>
          <p className="mt-3 text-primary-foreground/70">
            첫 회의를 무료로 처리해 보세요.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-brand-accent px-8 py-3 text-sm font-semibold text-brand-accent-foreground shadow hover:bg-brand-accent/90 transition-colors"
          >
            무료로 시작하기
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-border/40 py-8">
      <div className="container flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
        <span className="font-bold text-primary">ACTNOTE</span>
        <span>© {new Date().getFullYear()} ACTNOTE. All rights reserved.</span>
      </div>
    </footer>
  );
}
