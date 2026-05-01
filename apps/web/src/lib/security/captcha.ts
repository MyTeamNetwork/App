/**
 * Server-side Cloudflare Turnstile verification utility
 * Validates captcha tokens against the Turnstile siteverify API
 */

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEFAULT_TIMEOUT_MS = 3000;

export interface CaptchaVerifyResult {
    success: boolean;
    challenge_ts?: string;
    hostname?: string;
    action?: string;
    cdata?: string;
    error_codes?: string[];
}

export interface CaptchaConfig {
    secretKey?: string;
    timeout?: number;
    skipInDevelopment?: boolean;
}

/**
 * Verifies a Cloudflare Turnstile token with the Turnstile siteverify API
 *
 * @param token - The captcha token from the client
 * @param remoteIp - Optional client IP address for additional validation
 * @param config - Optional configuration overrides
 * @returns Verification result with success status and error codes
 */
export async function verifyCaptcha(
    token: string,
    remoteIp?: string,
    config?: CaptchaConfig
): Promise<CaptchaVerifyResult> {
    const secretKey =
        config?.secretKey ??
        process.env.TURNSTILE_SECRET_KEY ??
        process.env.HCAPTCHA_SECRET_KEY;
    const timeout = config?.timeout ?? DEFAULT_TIMEOUT_MS;
    const skipInDevelopment = config?.skipInDevelopment ?? true;

    // Development mode bypass
    if (skipInDevelopment && process.env.NODE_ENV === "development" && !secretKey) {
        console.warn("[captcha] Skipping verification in development mode - no secret key configured");
        return { success: true };
    }

    // Missing secret key in production
    if (!secretKey) {
        console.error("[captcha] TURNSTILE_SECRET_KEY is not configured");
        return {
            success: false,
            error_codes: ["missing-secret-key"],
        };
    }

    // Missing token
    if (!token || token.trim() === "") {
        return {
            success: false,
            error_codes: ["missing-input-response"],
        };
    }

    // Build form data for Turnstile API
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) {
        formData.append("remoteip", remoteIp);
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(TURNSTILE_VERIFY_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formData.toString(),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`[captcha] Turnstile API returned status ${response.status}`);
            return {
                success: false,
                error_codes: ["api-error"],
            };
        }

        const data = await response.json();

        // Map Turnstile response to our interface
        return {
            success: data.success === true,
            challenge_ts: data.challenge_ts,
            hostname: data.hostname,
            action: data.action,
            cdata: data.cdata,
            error_codes: data["error-codes"],
        };
    } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === "AbortError") {
            console.error("[captcha] Verification request timed out");
            return {
                success: false,
                error_codes: ["timeout"],
            };
        }

        console.error("[captcha] Verification request failed:", error);
        return {
            success: false,
            error_codes: ["network-error"],
        };
    }
}
