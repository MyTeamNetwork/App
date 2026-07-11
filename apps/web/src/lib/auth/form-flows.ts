import type { Provider } from "@supabase/supabase-js";

import { buildAuthCallbackUrl, buildRecoveryRedirectTo } from "@/lib/auth/redirect";

type AuthOperationResponse = {
  error: { message: string } | null;
};

type PasswordLoginOperation = (credentials: {
  email: string;
  password: string;
  options: { captchaToken: string };
}) => Promise<AuthOperationResponse>;

type MagicLinkOperation = (credentials: {
  email: string;
  options: {
    emailRedirectTo: string;
    captchaToken: string;
  };
}) => Promise<AuthOperationResponse>;

type OAuthLoginOperation = (credentials: {
  provider: Provider;
  options: {
    redirectTo: string;
    scopes?: string;
  };
}) => Promise<AuthOperationResponse>;

type PasswordResetOperation = (
  email: string,
  options: {
    redirectTo: string;
    captchaToken: string;
  }
) => Promise<AuthOperationResponse>;

export type AuthFormResult = { status: "success" } | { status: "error"; message: string };

function toAuthFormResult({ error }: AuthOperationResponse): AuthFormResult {
  return error ? { status: "error", message: error.message } : { status: "success" };
}

export async function performPasswordLogin({
  email,
  password,
  captchaToken,
  signInWithPassword,
}: {
  email: string;
  password: string;
  captchaToken: string;
  signInWithPassword: PasswordLoginOperation;
}): Promise<AuthFormResult> {
  const response = await signInWithPassword({
    email,
    password,
    options: { captchaToken },
  });

  return toAuthFormResult(response);
}

export async function sendMagicLoginLink({
  email,
  captchaToken,
  siteUrl,
  redirectTo,
  signInWithOtp,
}: {
  email: string;
  captchaToken: string;
  siteUrl: string;
  redirectTo: string;
  signInWithOtp: MagicLinkOperation;
}): Promise<AuthFormResult> {
  const response = await signInWithOtp({
    email,
    options: {
      emailRedirectTo: buildAuthCallbackUrl(siteUrl, redirectTo, "login"),
      captchaToken,
    },
  });

  return toAuthFormResult(response);
}

export async function startOAuthLogin({
  provider,
  scopes,
  siteUrl,
  redirectTo,
  signInWithOAuth,
}: {
  provider: Provider;
  scopes?: string;
  siteUrl: string;
  redirectTo: string;
  signInWithOAuth: OAuthLoginOperation;
}): Promise<AuthFormResult> {
  const response = await signInWithOAuth({
    provider,
    options: {
      redirectTo: buildAuthCallbackUrl(siteUrl, redirectTo, "login"),
      ...(scopes ? { scopes } : {}),
    },
  });

  return toAuthFormResult(response);
}

export async function requestPasswordReset({
  email,
  captchaToken,
  siteUrl,
  redirectTo,
  resetPasswordForEmail,
}: {
  email: string;
  captchaToken: string;
  siteUrl: string;
  redirectTo: string;
  resetPasswordForEmail: PasswordResetOperation;
}): Promise<AuthFormResult> {
  const response = await resetPasswordForEmail(email, {
    redirectTo: buildRecoveryRedirectTo(siteUrl, redirectTo),
    captchaToken,
  });

  return toAuthFormResult(response);
}
