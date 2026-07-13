import type { AcademicSchedule } from "@/types/database";

export const ACADEMIC_SCHEDULE_SELECT =
  "id, user_id, title, start_date, end_date, start_time, end_time, occurrence_type, day_of_week, day_of_month" as const;

export const ACADEMIC_SCHEDULE_WITH_USER_SELECT =
  `${ACADEMIC_SCHEDULE_SELECT}, users(name, email)` as const;

export type AvailabilitySchedule = Pick<
  AcademicSchedule,
  | "id"
  | "user_id"
  | "title"
  | "start_date"
  | "end_date"
  | "start_time"
  | "end_time"
  | "occurrence_type"
  | "day_of_week"
  | "day_of_month"
>;
