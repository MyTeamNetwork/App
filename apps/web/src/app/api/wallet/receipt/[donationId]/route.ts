import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/roles";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { buildReceiptResponse } from "@/lib/wallet/receipt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ donationId: string }> },
) {
  const { donationId: rawDonationId } = await ctx.params;
  const idParse = baseSchemas.uuid.safeParse(rawDonationId);
  if (!idParse.success) {
    return NextResponse.json({ error: "Invalid donation id" }, { status: 400 });
  }
  const donationId = idParse.data;

  const rateLimit = await checkRateLimit(req, {
    userId: null,
    feature: "wallet donation receipt",
    limitPerIp: 30,
    limitPerUser: 20,
  });
  if (!rateLimit.ok) {
    return buildRateLimitResponse(rateLimit);
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: rateLimit.headers },
    );
  }

  // Service client because donations are not RLS-readable by the donor's own
  // session if the donation was made anonymously. Ownership checks below.
  const service = createServiceClient();
  const { data: donation } = await service
    .from("organization_donations")
    .select(
      "id, amount_cents, currency, donor_name, donor_email, purpose, status, created_at, organization_id, anonymous",
    )
    .eq("id", donationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!donation) {
    return NextResponse.json(
      { error: "Donation not found" },
      { status: 404, headers: rateLimit.headers },
    );
  }
  if (donation.status !== "succeeded") {
    return NextResponse.json(
      { error: "Receipt is only available after payment succeeds." },
      { status: 409, headers: rateLimit.headers },
    );
  }

  // Donor (by email) can claim their receipt; org admins can re-issue.
  // Anonymous donations require a signed token (not implemented).
  const callerEmail = user.email?.toLowerCase() ?? "";
  const donorEmail = donation.donor_email?.toLowerCase() ?? "";
  const isDonor = donorEmail !== "" && callerEmail === donorEmail;

  let isOrgAdmin = false;
  if (!isDonor) {
    const { data: membership } = await service
      .from("user_organization_roles")
      .select("role, status")
      .eq("organization_id", donation.organization_id)
      .eq("user_id", user.id)
      .maybeSingle();
    isOrgAdmin = membership?.role === "admin" && membership?.status === "active";
  }

  if (!isDonor && !isOrgAdmin) {
    return NextResponse.json(
      { error: "You can only download receipts for your own donations." },
      { status: 403, headers: rateLimit.headers },
    );
  }

  const { data: org } = await service
    .from("organizations")
    .select("name, slug")
    .eq("id", donation.organization_id)
    .maybeSingle();
  if (!org?.slug || !org?.name) {
    return NextResponse.json(
      { error: "Donation organization missing" },
      { status: 500, headers: rateLimit.headers },
    );
  }

  return buildReceiptResponse({
    donation,
    org,
    rateLimitHeaders: rateLimit.headers,
  });
}
