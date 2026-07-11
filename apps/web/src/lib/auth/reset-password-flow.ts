type AuthOperationResponse = {
  error: { message: string } | null;
};

export type PasswordResetSubmitOutcome =
  | { status: "success"; tokenConsumed: boolean }
  | { status: "expired-link"; tokenConsumed: false }
  | { status: "error"; message: string; tokenConsumed: boolean };

/**
 * Submit step of the password reset flow.
 *
 * Recovery links forward their single-use `token_hash` to the reset page
 * unconsumed (see recovery-confirm-handler), so the token must be exchanged
 * via `verifyOtp` here — and only once: a retry after a failed password
 * update (e.g. weak password) must NOT re-verify, the first exchange already
 * established the session. Callers persist `tokenConsumed` across attempts.
 */
export async function submitPasswordReset({
  password,
  tokenHash,
  tokenAlreadyConsumed,
  verifyRecoveryToken,
  updatePassword,
}: {
  password: string;
  tokenHash: string | null;
  tokenAlreadyConsumed: boolean;
  verifyRecoveryToken: (args: {
    type: "recovery";
    token_hash: string;
  }) => Promise<AuthOperationResponse>;
  updatePassword: (args: { password: string }) => Promise<AuthOperationResponse>;
}): Promise<PasswordResetSubmitOutcome> {
  let tokenConsumed = tokenAlreadyConsumed;

  if (tokenHash && !tokenConsumed) {
    const { error: verifyError } = await verifyRecoveryToken({
      type: "recovery",
      token_hash: tokenHash,
    });
    if (verifyError) {
      return { status: "expired-link", tokenConsumed: false };
    }
    tokenConsumed = true;
  }

  const { error: updateError } = await updatePassword({ password });
  if (updateError) {
    return { status: "error", message: updateError.message, tokenConsumed };
  }

  return { status: "success", tokenConsumed };
}
