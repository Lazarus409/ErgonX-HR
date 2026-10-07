import { apiGet, apiGetList, apiPost, apiPut } from "./client";
import type { AppNotification, NotificationBulkAction, NotificationModule, NotificationPreferences } from "@/types/notifications";

export interface NotificationQuery {
  unread?: boolean;
  /** true lists the archive; otherwise the inbox. */
  archived?: boolean;
  module?: NotificationModule;
}

export async function getNotifications(params: NotificationQuery = {}): Promise<AppNotification[]> {
  const query: Record<string, string> = {};
  if (params.unread) query.unread = "true";
  if (params.archived) query.archived = "true";
  if (params.module) query.module = params.module;
  const page = await apiGetList<AppNotification>("/notifications/", Object.keys(query).length ? query : undefined);
  return page.results;
}

export async function markNotificationRead(id: string): Promise<AppNotification> {
  return apiPost<AppNotification>(`/notifications/${id}/mark-read/`);
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiPost<{ updated: number }>("/notifications/mark-all-read/");
}

/** Mark read, archive or restore several of the caller's own notifications. */
export async function bulkNotificationAction(ids: string[], action: NotificationBulkAction): Promise<{ action: NotificationBulkAction; updated: number }> {
  return apiPost<{ action: NotificationBulkAction; updated: number }, { ids: string[]; action: NotificationBulkAction }>("/notifications/bulk/", { ids, action });
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return apiGet<NotificationPreferences>("/notifications/preferences/");
}

export async function saveNotificationPreferences(emailModules: NotificationModule[]): Promise<NotificationPreferences> {
  return apiPut<NotificationPreferences, { email_modules: NotificationModule[] }>("/notifications/preferences/", { email_modules: emailModules });
}
