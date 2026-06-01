"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogOut, Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  notificationClickTarget,
  type InAppNotification,
} from "@/lib/notifications/notification-types";
import { NotificationDropdown } from "@/components/notifications/NotificationDropdown";
import { LogoutConfirmModal } from "@/components/layout/LogoutConfirmModal";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { useUserProfile } from "@/components/user/UserProfileProvider";

interface Notification extends InAppNotification {}

interface DashboardHeaderProps {
  title?: string;
  backHref?: string;
  onBack?: () => void;
  /** Figma Home — amber notification bell (default: slate). */
  notificationBellAccent?: boolean;
}

export function DashboardHeader({
  title = "Home",
  backHref,
  onBack,
  notificationBellAccent = false,
}: DashboardHeaderProps) {
  const router = useRouter();
  const { setCurrentWorkspace } = useWorkspaceContext();
  const {
    displayName,
    initials,
    avatarDisplayUrl: avatarUrl,
    avatarBroken,
    setAvatarBroken,
  } = useUserProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // 알림 로드
  const loadNotifications = useCallback(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("notifications")
      .select("id, type, title, message, meeting_id, workspace_id, is_read, created_at")
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

  function openLogoutModal() {
    setMenuOpen(false);
    setLogoutModalOpen(true);
  }

  async function handleLogoutConfirm() {
    setLoggingOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      setLogoutModalOpen(false);
      router.push("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
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
    if (!n.is_read) void markRead(n.id);
    setBellOpen(false);

    if (n.type === "join_request_received" && n.workspace_id) {
      setCurrentWorkspace(n.workspace_id);
    }

    const target = notificationClickTarget(n);
    if (target) {
      router.push(target);
    }
  }

  function renderAvatar(sizeClass: string, textClass: string) {
    if (avatarUrl && !avatarBroken) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className={`${sizeClass} rounded-full object-cover`}
          onError={() => setAvatarBroken(true)}
        />
      );
    }
    return (
      <div
        className={`${sizeClass} flex items-center justify-center rounded-full ${textClass} font-bold text-white`}
        style={{ background: "linear-gradient(135deg, #2e5c8a 0%, #1e3a5f 100%)" }}
      >
        {initials}
      </div>
    );
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
            className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-[#f8fafc] ${
              notificationBellAccent ? "text-[#f59e0b]" : "text-[#64748b]"
            }`}
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" strokeWidth={2.25} fill={notificationBellAccent ? "currentColor" : "none"} />
            {unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#ff6b35] text-[10px] font-bold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {bellOpen ? (
            <NotificationDropdown
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkAllRead={markAllRead}
              onNotificationClick={handleNotifClick}
            />
          ) : null}
        </div>

        {/* Avatar + dropdown */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full transition-opacity hover:opacity-90"
            aria-label={displayName}
          >
            {renderAvatar("h-10 w-10", "text-[14px]")}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white py-1 shadow-[0px_8px_24px_rgba(10,37,64,0.12)]">
              <button
                type="button"
                onClick={openLogoutModal}
                className="flex w-full items-center gap-2.5 whitespace-nowrap px-4 py-2.5 text-[14px] font-medium text-[#495057] transition-colors hover:bg-[#f8fafc]"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>

      <LogoutConfirmModal
        open={logoutModalOpen}
        confirming={loggingOut}
        onClose={() => {
          if (loggingOut) return;
          setLogoutModalOpen(false);
        }}
        onConfirm={handleLogoutConfirm}
      />
    </header>
  );
}
