"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogOut, User, Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Notification {
  id: string;
  type: "analysis_complete" | "analysis_failed" | "action_assigned";
  title: string;
  message: string | null;
  meeting_id: string | null;
  is_read: boolean;
  created_at: string;
}

interface DashboardHeaderProps {
  title?: string;
  backHref?: string;
  onBack?: () => void;
}

export function DashboardHeader({ title = "Home", backHref, onBack }: DashboardHeaderProps) {
  const router = useRouter();
  const [initials, setInitials] = useState("?");
  const [email, setEmail] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // 유저 정보 로드
  useEffect(() => {
    async function loadUser() {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) {
        setEmail(data.user.email);
        const parts = data.user.email.split("@")[0].split(/[._-]/);
        const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
        setInitials(letters || data.user.email[0].toUpperCase());
      }
    }
    loadUser();
  }, []);

  // 알림 로드
  const loadNotifications = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("notifications")
      .select("id, type, title, message, meeting_id, is_read, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) setNotifications(data as Notification[]);
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Realtime 구독 — 새 알림 INSERT 시 뱃지 자동 업데이트
  // 채널 이름은 매 마운트마다 고유해야 함. React Strict Mode 이중 실행 시 같은 이름 채널이
  // 이미 subscribe 된 상태로 재사용되면 `.on()` 추가 시 "after subscribe()" 오류가 난다.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const name = `notifications-rt-${user.id}-${crypto.randomUUID()}`;
      channel = supabase
        .channel(name)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const newNotif = payload.new as Notification;
            setNotifications((prev) => [newNotif, ...prev]);
          }
        )
        .subscribe();

      if (cancelled) {
        supabase.removeChannel(channel);
        channel = null;
      }
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  async function markAllRead() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  async function markRead(id: string) {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  }

  function handleNotifClick(n: Notification) {
    if (!n.is_read) markRead(n.id);
    if (n.meeting_id) {
      setBellOpen(false);
      if (n.type === "analysis_failed") {
        router.push(`/meetings/${n.meeting_id}/analysis-error`);
      } else {
        router.push(`/meetings/${n.meeting_id}`);
      }
    }
  }

  function notifIcon(type: Notification["type"]) {
    if (type === "analysis_complete") return "✅";
    if (type === "analysis_failed") return "❌";
    return "📌";
  }

  function timeAgo(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[#e2e8f0] bg-white px-10">
      <div className="flex items-center gap-3">
        {(backHref || onBack) && (
          onBack ? (
            <button onClick={onBack} className="text-[#64748b] hover:text-[#0a2540] transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <Link href={backHref!} className="text-[#64748b] hover:text-[#0a2540] transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          )
        )}
        <h1 className="text-[24px] font-bold text-[#0a2540]">{title}</h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Bell — NOTI-001 */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => { setBellOpen((v) => !v); if (!bellOpen) loadNotifications(); }}
            className="relative flex h-10 w-10 items-center justify-center rounded-lg text-[#64748b] hover:bg-[#f8fafc] transition-colors"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#ff6b35] text-[10px] font-bold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-[#e2e8f0] bg-white shadow-lg overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-[#e2e8f0] px-4 py-3">
                <span className="text-[14px] font-bold text-[#0a2540]">Notifications</span>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="flex items-center gap-1 text-[12px] text-[#64748b] hover:text-[#ff6b35] transition-colors"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Mark all read
                  </button>
                )}
              </div>

              {/* List */}
              <div className="max-h-[360px] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                    <Bell className="h-8 w-8 text-[#e2e8f0]" />
                    <p className="text-[13px] text-[#94a3b8]">No notifications yet</p>
                  </div>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => handleNotifClick(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#f8fafc] transition-colors border-b border-[#f1f5f9] last:border-0 ${
                        !n.is_read ? "bg-[#fff8f6]" : ""
                      }`}
                    >
                      <span className="mt-0.5 text-[18px] shrink-0">{notifIcon(n.type)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-[13px] leading-snug ${!n.is_read ? "font-bold text-[#0a2540]" : "font-medium text-[#64748b]"}`}>
                            {n.title}
                          </p>
                          {!n.is_read && (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-[#ff6b35]" />
                          )}
                        </div>
                        {n.message && (
                          <p className="mt-0.5 text-[12px] text-[#94a3b8] line-clamp-2">{n.message}</p>
                        )}
                        <p className="mt-1 text-[11px] text-[#94a3b8]">{timeAgo(n.created_at)}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Avatar + dropdown */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-[14px] font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #2e5c8a 0%, #1e3a5f 100%)" }}
          >
            {initials}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-lg">
              <div className="flex items-center gap-3 border-b border-[#e2e8f0] px-4 py-3">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                  style={{ background: "linear-gradient(135deg, #2e5c8a 0%, #1e3a5f 100%)" }}
                >
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-[#0a2540]">{initials}</p>
                  <p className="truncate text-[11px] text-[#64748b]">{email}</p>
                </div>
              </div>
              <div className="p-1">
                <Link
                  href="/settings/personal"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540] transition-colors"
                >
                  <User className="h-4 w-4" />
                  Profile
                </Link>
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
