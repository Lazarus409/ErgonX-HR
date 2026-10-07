/**
 * Personalised workspace payload returned by `GET /api/v1/home/`.
 *
 * The backend determines both the greeting timezone and the actions the
 * active membership is allowed to use. Route hints are therefore treated as
 * backend-owned navigation rather than reconstructed in the browser.
 */

import type { TeamSnapshot } from "@/types/dashboards";

export interface HomeGreetingContext {
  greeting: string;
  user_display_name: string;
  institution_name: string;
  institution_timezone: string;
  local_time: string;
}

export interface HomeQuickAction {
  code: string;
  label: string;
  route_hint: string;
  is_pinned: boolean;
}

export interface HomeRecentWork {
  type: string;
  id: string;
  reference: string;
  title: string;
  status: string;
  resume_action: string;
  resume_route: string;
  updated_at: string;
  can_resume: boolean;
}

export interface HomeAttentionItem {
  code: string;
  severity: string;
  title: string;
  description: string;
  action_code: string;
  entity_type: string;
  entity_id: string | null;
  reference: string;
  due_at: string | null;
}

export interface HomeNotification {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  created_at: string;
}

export interface HomePayload {
  greeting_context: HomeGreetingContext;
  quick_actions: HomeQuickAction[];
  recent_work: HomeRecentWork[];
  attention_items: HomeAttentionItem[];
  notifications_summary: {
    unread_count: number;
    latest: HomeNotification[];
  };
  /** Self-service context; null when the user has no employee record here. */
  optional_personal_snapshot: PersonalSnapshot | null;
  /** "Team today" for members who head a department; null otherwise. */
  team_snapshot: TeamSnapshot | null;
}

export interface PersonalShift {
  date: string;
  schedule: string;
  off_day: boolean;
  flexible: boolean;
  start: string | null;
  end: string | null;
  required_minutes: number;
}

export interface PersonalAttentionItem {
  code: string;
  severity: "HIGH" | "NORMAL";
  title: string;
  description: string;
  route: string;
}

export interface PersonalSnapshot {
  /** Up to seven days from today, resolved from the employee's schedule. */
  upcoming_shifts: PersonalShift[];
  attention: PersonalAttentionItem[];
  activity: { leave_requests_this_year?: number; attendance_corrections_pending?: number; documents_on_file: number };
}
