export type ChatAttachment = {
  storagePath: string;
  fileName: string;
  mimeType:
    | "application/pdf"
    | "image/png"
    | "image/jpeg"
    | "image/jpg"
    | "text/csv"
    | "application/vnd.ms-excel";
};

export const SCHEDULE_ATTACHMENT_MIME_TYPES = new Set<ChatAttachment["mimeType"]>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

// CSV attachments route to `import_events_csv` (structured parse + AI column
// mapping), kept separate from the PDF/image schedule-extraction mime set.
export const CSV_ATTACHMENT_MIME_TYPES = new Set<ChatAttachment["mimeType"]>([
  "text/csv",
  "application/vnd.ms-excel",
]);
