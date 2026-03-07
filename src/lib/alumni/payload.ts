import type { NewAlumniForm, EditAlumniForm } from "@/lib/schemas/member";

export function buildAlumniCreatePayload(organizationId: string, data: NewAlumniForm) {
  return {
    organization_id: organizationId,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email || null,
    graduation_year: data.graduation_year ? parseInt(data.graduation_year, 10) : null,
    major: data.major || null,
    job_title: data.job_title || null,
    photo_url: data.photo_url || null,
    notes: data.notes || null,
    linkedin_url: data.linkedin_url || null,
    phone_number: data.phone_number || null,
    industry: data.industry || null,
    current_company: data.current_company || null,
    current_city: data.current_city || null,
    position_title: data.position_title || null,
  };
}

export function buildAlumniUpdatePayload(data: EditAlumniForm) {
  return {
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email || null,
    graduation_year: data.graduation_year ? parseInt(data.graduation_year, 10) : null,
    major: data.major || null,
    job_title: data.job_title || null,
    photo_url: data.photo_url || null,
    notes: data.notes || null,
    linkedin_url: data.linkedin_url || null,
    phone_number: data.phone_number || null,
    industry: data.industry || null,
    current_company: data.current_company || null,
    current_city: data.current_city || null,
    position_title: data.position_title || null,
    updated_at: new Date().toISOString(),
  };
}
