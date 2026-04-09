export type SelectOption = { value: string; label: string };

export type MentorshipStatus = "active" | "paused" | "completed";

export type MentorDirectoryEntry = {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  photo_url: string | null;
  industry: string | null;
  graduation_year: number | null;
  current_company: string | null;
  current_city: string | null;
  expertise_areas: string[] | null;
  bio: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  contact_phone: string | null;
};

export type MentorProfileRecord = {
  id: string;
  bio: string | null;
  expertise_areas: string[];
  contact_email: string | null;
  contact_linkedin: string | null;
  contact_phone: string | null;
  is_active: boolean;
  organization_id: string;
  user_id: string;
};

export const STATUS_OPTIONS: SelectOption[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];
