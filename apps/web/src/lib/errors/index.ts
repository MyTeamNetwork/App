// Server-side exports
export { captureServerError, captureException, type CaptureErrorParams } from "./server";
export { withErrorCapture, captureApiError } from "./api-wrapper";
export { sanitizeError, captureSanitized, runWithoutCapture, type SanitizeOptions } from "./sanitize";
export { checkAndNotify } from "./notify";

// Client-side exports (use in 'use client' components only)
export { initErrorCapture, captureClientError, captureReactError, setUserId } from "./client";
