/**
 * The Admin page's data, as `GET /admin/stats` sends it (backend
 * app/api/admin.py, ticket 75 Decision 7). Counts and timings only.
 */

/** The totals at the top of the page. */
export interface AdminOverview {
  users: number;
  new_users_7d: number;
  new_users_30d: number;
  active_users_7d: number;
  active_users_30d: number;
  sign_ins_by_provider: Record<string, number>;
  rooms: number;
  documents: number;
  maps: number;
  geographic_maps: number;
  session_zeros: number;
  clocks: number;
  files: number;
  files_bytes: number;
  images: number;
  database_bytes: number;
}

/** New users and Rooms in the week starting on `week` (Monday, UTC). */
export interface AdminWeek {
  week: string;
  new_users: number;
  new_rooms: number;
}

/** A route group over the period; the percentiles are `null` without timed requests. */
export interface AdminGroupTraffic {
  group: string;
  requests: number;
  client_errors: number;
  server_errors: number;
  p50_ms: number | null;
  p95_ms: number | null;
}

/** All requests in one hour. */
export interface AdminHourTraffic {
  hour: string;
  requests: number;
  server_errors: number;
}

/** One stored server error: never its message or its user. */
export interface AdminError {
  occurred_at: string;
  method: string;
  route: string;
  status: number;
  exc_type: string | null;
  request_id: string;
}

/** Room PDF exports or Document imports. */
export interface AdminJobCounts {
  running: number;
  done_7d: number;
  failed_7d: number;
}

/** The whole `GET /admin/stats` response. */
export interface AdminStats {
  generated_at: string;
  overview: AdminOverview;
  growth: AdminWeek[];
  traffic: { days: number; groups: AdminGroupTraffic[]; hours: AdminHourTraffic[] };
  errors: AdminError[];
  jobs: { exports: AdminJobCounts; imports: AdminJobCounts };
}
