import type { Form } from "@/types/database";

export const FORM_LIST_SELECT = "id, title, description, fields, is_active" as const;
export const FORM_DOCUMENT_LIST_SELECT = "id, title, description" as const;

export type FormListItem = Pick<
  Form,
  "id" | "title" | "description" | "fields" | "is_active"
>;
