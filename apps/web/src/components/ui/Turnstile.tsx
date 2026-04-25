"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
      execute: (widgetId: string) => void;
    };
  }
}

interface TurnstileRenderOptions {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "invisible";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: (error: string) => void;
  retry?: "auto" | "never";
  "refresh-expired"?: "auto" | "manual" | "never";
}

export interface TurnstileProps {
  siteKey?: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error: string) => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "invisible";
  className?: string;
}

export interface TurnstileRef {
  execute: () => void;
  reset: () => void;
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  if (window.turnstile) {
    return Promise.resolve();
  }
  if (scriptPromise) {
    return scriptPromise;
  }

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src^="${TURNSTILE_SCRIPT_URL}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Turnstile")));
      return;
    }

    const script = document.createElement("script");
    script.src = `${TURNSTILE_SCRIPT_URL}?render=explicit`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile"));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export const Turnstile = forwardRef<TurnstileRef, TurnstileProps>(
  (
    {
      siteKey,
      onVerify,
      onExpire,
      onError,
      theme = "light",
      size = "normal",
      className = "",
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [timedOut, setTimedOut] = useState(false);

    const resolvedSiteKey = siteKey || TURNSTILE_SITE_KEY;

    const handleVerify = useCallback(
      (token: string) => {
        setError(null);
        onVerify(token);
      },
      [onVerify],
    );

    const handleExpire = useCallback(() => {
      onExpire?.();
    }, [onExpire]);

    const handleError = useCallback(
      (event: string) => {
        setError(event);
        onError?.(event);
      },
      [onError],
    );

    useImperativeHandle(ref, () => ({
      execute: () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.execute(widgetIdRef.current);
        }
      },
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }));

    useEffect(() => {
      if (!resolvedSiteKey || !containerRef.current) return;

      let cancelled = false;
      const container = containerRef.current;
      const timeoutId = window.setTimeout(() => {
        if (!isReady) setTimedOut(true);
      }, 8000);

      loadTurnstileScript()
        .then(() => {
          if (cancelled || !window.turnstile || !container) return;
          widgetIdRef.current = window.turnstile.render(container, {
            sitekey: resolvedSiteKey,
            theme,
            size,
            retry: "auto",
            "refresh-expired": "auto",
            callback: handleVerify,
            "expired-callback": handleExpire,
            "error-callback": handleError,
          });
          setIsReady(true);
          setTimedOut(false);
        })
        .catch((err: Error) => {
          if (!cancelled) handleError(err.message);
        });

      return () => {
        cancelled = true;
        window.clearTimeout(timeoutId);
        if (widgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            // noop — widget already removed
          }
          widgetIdRef.current = null;
        }
      };
    }, [resolvedSiteKey, theme, size, handleVerify, handleExpire, handleError, isReady]);

    if (process.env.NODE_ENV === "development" && !resolvedSiteKey) {
      return (
        <div className={`text-xs text-muted-foreground ${className}`}>
          Captcha bypassed (dev mode)
        </div>
      );
    }

    if (!resolvedSiteKey) {
      return (
        <div
          className={`text-error text-sm ${className}`}
          role="alert"
          aria-live="polite"
        >
          Turnstile configuration error: Site key is missing
        </div>
      );
    }

    return (
      <div className={`relative ${className}`}>
        {!isReady && !timedOut && (
          <div
            className="flex items-center justify-center p-4 text-muted-foreground"
            role="status"
            aria-label="Loading captcha"
          >
            <svg
              className="animate-spin h-5 w-5 mr-2"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Loading captcha...</span>
          </div>
        )}

        {!isReady && timedOut && (
          <div
            className="flex flex-col items-center justify-center p-4 text-muted-foreground text-sm"
            role="alert"
          >
            <p>Captcha failed to load. This may be caused by an ad blocker.</p>
            <button
              type="button"
              className="mt-2 text-primary underline hover:no-underline"
              onClick={() => window.location.reload()}
            >
              Reload page
            </button>
          </div>
        )}

        {error && (
          <div
            className="text-error text-sm mb-2"
            role="alert"
            aria-live="polite"
          >
            Captcha error: {error}
          </div>
        )}

        <div ref={containerRef} className={!isReady ? "invisible absolute" : ""} />
      </div>
    );
  },
);

Turnstile.displayName = "Turnstile";

export default Turnstile;
