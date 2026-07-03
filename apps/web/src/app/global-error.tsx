"use client";

import { useEffect } from "react";
import { captureClientError } from "@/lib/errors/client";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Root-layout crash boundary. Mirrors `app/error.tsx`'s capture pattern with
 * `boundary: "global"`. Per Next.js, global-error replaces the root layout
 * when it crashes, so it must render its own <html> and <body> — global CSS
 * is unavailable here, hence inline styles.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    captureClientError({
      name: error.name,
      message: error.message,
      stack: error.stack,
      severity: "critical",
      meta: { digest: error.digest, boundary: "global" },
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          backgroundColor: "#fff",
          color: "#111827",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6b7280", marginBottom: "1.5rem" }}>
            We hit an unexpected error loading the app. You can retry, or head back home.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "0.75rem",
                color: "#6b7280",
                marginBottom: "1.5rem",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              Ref: {error.digest}
            </p>
          )}
          <div style={{ display: "flex", justifyContent: "center", gap: "0.5rem" }}>
            <button
              onClick={reset}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.375rem",
                border: "none",
                backgroundColor: "#111827",
                color: "#fff",
                fontSize: "0.875rem",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "0.375rem",
                border: "1px solid #d1d5db",
                backgroundColor: "#fff",
                color: "#111827",
                fontSize: "0.875rem",
                textDecoration: "none",
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
