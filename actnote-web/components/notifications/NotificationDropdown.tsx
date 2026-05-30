"use client";

import { Bell, Check } from "lucide-react";
import type { InAppNotification } from "@/lib/notifications/notification-types";
import { parseJoinRequestNotification } from "@/lib/notifications/join-request-copy";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? "" : "s"} ago`;
}

function JoinRequestNotificationRow({
  notification: n,
  onClick,
}: {
  notification: InAppNotification;
  onClick: () => void;
}) {
  const { requesterName, workspaceName, requesterInitials } = parseJoinRequestNotification(
    n.title,
    n.message,
  );
  const unread = !n.is_read;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 border-b border-[#f1f3f5] px-5 py-3.5 text-left transition-colors hover:opacity-95 ${
        unread ? "bg-[#fffbeb]" : "bg-white hover:bg-[#f8fafc]"
      }`}
    >
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#8b5cf6] text-[14px] font-bold text-white"
        aria-hidden
      >
        {requesterInitials.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] text-[#212529] ${unread ? "font-semibold" : "font-medium"}`}>
          New access request
        </p>
        <p className="mt-0.5 text-[12px] leading-[18px] text-[#6c757d]">
          {requesterName} wants to join <span className="font-bold">{workspaceName}</span> workspace
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-[#adb5bd]">{timeAgo(n.created_at)}</span>
          <span className="text-[11px] font-semibold text-[#f26522]">
            {unread ? "Review request →" : "View access requests →"}
          </span>
        </div>
      </div>
      {unread ? (
        <span className="mt-1.5 size-[7px] shrink-0 rounded-full bg-[#f26522]" aria-hidden />
      ) : null}
    </button>
  );
}

function DefaultNotificationRow({
  notification: n,
  onClick,
}: {
  notification: InAppNotification;
  onClick: () => void;
}) {
  const unread = !n.is_read;
  const isAnalysisComplete = n.type === "analysis_complete";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 border-b border-[#f1f3f5] px-5 py-3.5 text-left transition-colors ${
        unread && !isAnalysisComplete ? "bg-[#fff8f6]" : "bg-white hover:bg-[#f8fafc]"
      }`}
    >
      {isAnalysisComplete ? (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#3b82f6] text-white">
          <Check className="size-4" strokeWidth={2.5} />
        </div>
      ) : (
        <span className="mt-0.5 shrink-0 text-[18px]" aria-hidden>
          {n.type === "analysis_failed" ? "❌" : n.type === "action_assigned" ? "📌" : "🔔"}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p
            className={`text-[13px] leading-snug text-[#212529] ${
              unread ? "font-semibold" : "font-medium text-[#64748b]"
            }`}
          >
            {n.title}
          </p>
          {unread ? (
            <span className="mt-1 size-[7px] shrink-0 rounded-full bg-[#f26522]" aria-hidden />
          ) : null}
        </div>
        {n.message ? (
          <p className="mt-0.5 text-[12px] leading-[18px] text-[#6c757d] line-clamp-2">{n.message}</p>
        ) : null}
        <p className="mt-1 text-[11px] text-[#adb5bd]">{timeAgo(n.created_at)}</p>
      </div>
    </button>
  );
}

export function NotificationDropdown({
  notifications,
  unreadCount,
  onMarkAllRead,
  onNotificationClick,
}: {
  notifications: InAppNotification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onNotificationClick: (n: InAppNotification) => void;
}) {
  return (
    <div className="absolute right-0 top-full z-30 mt-2 w-[320px] overflow-hidden rounded-xl border border-[#e9ecef] bg-white shadow-[0px_8px_32px_rgba(0,0,0,0.12)]">
      <div className="flex items-center justify-between border-b border-[#e9ecef] px-5 py-4">
        <span className="text-[15px] font-bold text-[#212529]">Notifications</span>
        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-[12px] font-medium text-[#f26522] hover:opacity-80"
          >
            Mark all as read
          </button>
        ) : null}
      </div>

      <div className="max-h-[360px] overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Bell className="h-8 w-8 text-[#e2e8f0]" />
            <p className="text-[13px] text-[#94a3b8]">No notifications yet</p>
          </div>
        ) : (
          notifications.map((n) =>
            n.type === "join_request_received" ? (
              <JoinRequestNotificationRow
                key={n.id}
                notification={n}
                onClick={() => onNotificationClick(n)}
              />
            ) : (
              <DefaultNotificationRow
                key={n.id}
                notification={n}
                onClick={() => onNotificationClick(n)}
              />
            ),
          )
        )}
      </div>

      {notifications.length > 0 ? (
        <div className="border-t border-[#e9ecef] px-5 py-3 text-center">
          <span className="text-[13px] font-medium text-[#6c757d]">View more notifications</span>
        </div>
      ) : null}
    </div>
  );
}
