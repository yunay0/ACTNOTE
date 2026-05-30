/** In-app notification types stored in `notifications.type`. */
export type InAppNotificationType =
  | "analysis_complete"
  | "analysis_failed"
  | "action_assigned"
  | "join_request_received"
  | "join_request_approved"
  | "join_request_declined"
  | "integration_reauth_required";

export interface InAppNotification {
  id: string;
  type: InAppNotificationType;
  title: string;
  message: string | null;
  meeting_id: string | null;
  workspace_id: string | null;
  is_read: boolean;
  created_at: string;
}

export function notificationIcon(type: InAppNotificationType): string {
  switch (type) {
    case "analysis_complete":
      return "✅";
    case "analysis_failed":
      return "❌";
    case "action_assigned":
      return "📌";
    case "join_request_received":
      return "👤";
    case "join_request_approved":
      return "✓";
    case "join_request_declined":
      return "✕";
    case "integration_reauth_required":
      return "🔗";
    default:
      return "📌";
  }
}

/** Route target when the user clicks a notification row. */
export function notificationClickTarget(n: InAppNotification): string | null {
  if (n.type === "integration_reauth_required") {
    return "/settings/integrations";
  }

  if (n.type === "join_request_received") {
    const params = new URLSearchParams({ section: "members", join: "requests" });
    if (n.workspace_id) params.set("workspace", n.workspace_id);
    return `/settings/workspace?${params.toString()}`;
  }

  if (n.type === "join_request_approved" || n.type === "join_request_declined") {
    return "/workspace/select";
  }

  if (n.meeting_id) {
    if (n.type === "analysis_failed") {
      return `/meetings/${n.meeting_id}/analysis-error`;
    }
    return `/meetings/${n.meeting_id}`;
  }

  return null;
}
