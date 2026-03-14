import { toast } from "sonner";

/**
 * Show a toast notification via Sonner.
 * Centralizes all imperative toast calls — prefer this over importing `toast` directly.
 */
export function showFeedback(
  message: string,
  variant: "success" | "error" | "warning" | "info" = "info",
): void {
  switch (variant) {
    case "success":
      toast.success(message);
      break;
    case "error":
      toast.error(message);
      break;
    case "warning":
      toast.warning(message);
      break;
    case "info":
      toast(message);
      break;
  }
}
