import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  type DirectChatSupabase,
  ensureDirectChatForUser,
  findExactDirectChatGroup,
  resolveChatMessageRecipient,
  sendAiAssistedDirectChatMessage,
} from "../src/lib/chat/direct-chat.ts";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const SENDER_USER_ID = "00000000-0000-4000-8000-000000000002";
const RECIPIENT_USER_ID = "00000000-0000-4000-8000-000000000003";
const RECIPIENT_MEMBER_ID = "00000000-0000-4000-8000-000000000004";

test("findExactDirectChatGroup reuses an active exact two-person chat", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("chat_groups", [
    {
      id: "00000000-0000-4000-8000-000000000010",
      organization_id: ORG_ID,
      deleted_at: null,
      updated_at: "2026-04-13T00:00:00.000Z",
    },
  ]);
  supabase.seed("chat_group_members", [
    {
      chat_group_id: "00000000-0000-4000-8000-000000000010",
      organization_id: ORG_ID,
      user_id: SENDER_USER_ID,
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000010",
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      removed_at: null,
    },
  ]);

  const result = await findExactDirectChatGroup(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    recipientUserId: RECIPIENT_USER_ID,
  });

  assert.deepEqual(result, {
    chatGroupId: "00000000-0000-4000-8000-000000000010",
    error: null,
  });
});

test("findExactDirectChatGroup refuses chats with extra active members or removed membership history", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("chat_groups", [
    {
      id: "00000000-0000-4000-8000-000000000011",
      organization_id: ORG_ID,
      deleted_at: null,
      updated_at: "2026-04-13T00:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000012",
      organization_id: ORG_ID,
      deleted_at: null,
      updated_at: "2026-04-12T00:00:00.000Z",
    },
  ]);
  supabase.seed("chat_group_members", [
    {
      chat_group_id: "00000000-0000-4000-8000-000000000011",
      organization_id: ORG_ID,
      user_id: SENDER_USER_ID,
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000011",
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000011",
      organization_id: ORG_ID,
      user_id: "00000000-0000-4000-8000-000000000099",
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000012",
      organization_id: ORG_ID,
      user_id: SENDER_USER_ID,
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000012",
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000012",
      organization_id: ORG_ID,
      user_id: "00000000-0000-4000-8000-000000000098",
      removed_at: "2026-04-01T00:00:00.000Z",
    },
  ]);

  const result = await findExactDirectChatGroup(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    recipientUserId: RECIPIENT_USER_ID,
  });

  assert.deepEqual(result, {
    chatGroupId: null,
    error: null,
  });
});

test("sendAiAssistedDirectChatMessage creates a new 1:1 chat and records ai_assisted metadata", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("user_organization_roles", [
    {
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      role: "active_member",
      status: "active",
    },
  ]);
  supabase.seed("members", [
    {
      id: RECIPIENT_MEMBER_ID,
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      status: "active",
      deleted_at: null,
      first_name: "Jason",
      last_name: "Leonard",
      email: "jason@example.com",
    },
  ]);

  const result = await sendAiAssistedDirectChatMessage(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    recipientMemberId: RECIPIENT_MEMBER_ID,
    recipientUserId: RECIPIENT_USER_ID,
    recipientDisplayName: "Jason Leonard",
    body: "Can you join the alumni panel next Thursday?",
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const groups = supabase.getRows("chat_groups");
  const memberships = supabase.getRows("chat_group_members");
  const messages = supabase.getRows("chat_messages");

  assert.equal(groups.length, 1);
  assert.equal(memberships.length, 2);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.author_id, SENDER_USER_ID);
  assert.equal(messages[0]?.status, "approved");
  assert.deepEqual(messages[0]?.metadata, { ai_assisted: true });
});

test("resolveChatMessageRecipient ignores duplicate org rows that are not chat-eligible", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("user_organization_roles", [
    {
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      role: "active_member",
      status: "active",
    },
  ]);
  supabase.seed("members", [
    {
      id: "00000000-0000-4000-8000-000000000020",
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      status: "active",
      deleted_at: null,
      first_name: "Louis",
      last_name: "Ciccone",
      email: "cicconel@myteamnetwork.com",
    },
    {
      id: "00000000-0000-4000-8000-000000000021",
      organization_id: ORG_ID,
      user_id: null,
      status: "active",
      deleted_at: null,
      first_name: "Louis",
      last_name: "Ciccone",
      email: "lociccone11@gmail.com",
    },
  ]);

  const result = await resolveChatMessageRecipient(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    personQuery: "Louis Ciccone",
  });

  assert.deepEqual(result, {
    kind: "resolved",
    memberId: "00000000-0000-4000-8000-000000000020",
    userId: RECIPIENT_USER_ID,
    displayName: "Louis Ciccone",
    existingChatGroupId: null,
  });
});

test("resolveChatMessageRecipient rejects explicit recipients without active org membership", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("user_organization_roles", [
    {
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      role: "alumni",
      status: "revoked",
    },
  ]);
  supabase.seed("members", [
    {
      id: RECIPIENT_MEMBER_ID,
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      status: "active",
      deleted_at: null,
      first_name: "Jason",
      last_name: "Leonard",
      email: "jason@example.com",
      role: "alumni",
    },
  ]);

  const result = await resolveChatMessageRecipient(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    recipientMemberId: RECIPIENT_MEMBER_ID,
  });

  assert.deepEqual(result, {
    kind: "unavailable",
    requestedRecipient: "Jason Leonard",
    reason: "recipient_inactive",
  });
});

test("resolveChatMessageRecipient can resolve linked active alumni by name", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("alumni", [
    {
      id: "00000000-0000-4000-8000-000000000030",
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      deleted_at: null,
      first_name: "Taylor",
      last_name: "Alum",
      email: "taylor@example.com",
    },
  ]);
  supabase.seed("user_organization_roles", [
    {
      user_id: RECIPIENT_USER_ID,
      organization_id: ORG_ID,
      role: "alumni",
      status: "active",
    },
  ]);

  const result = await resolveChatMessageRecipient(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    personQuery: "Taylor Alum",
  });

  assert.deepEqual(result, {
    kind: "resolved",
    memberId: "00000000-0000-4000-8000-000000000030",
    userId: RECIPIENT_USER_ID,
    displayName: "Taylor Alum",
    existingChatGroupId: null,
  });
});

test("ensureDirectChatForUser creates a 1:1 chat for active org users", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("user_organization_roles", [
    {
      user_id: SENDER_USER_ID,
      organization_id: ORG_ID,
      role: "active_member",
      status: "active",
    },
    {
      user_id: RECIPIENT_USER_ID,
      organization_id: ORG_ID,
      role: "alumni",
      status: "active",
    },
  ]);
  supabase.seed("users", [
    {
      id: RECIPIENT_USER_ID,
      name: "Taylor Alum",
      email: "taylor@example.com",
    },
  ]);

  const result = await ensureDirectChatForUser(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    recipientUserId: RECIPIENT_USER_ID,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.reused, false);
  assert.equal(supabase.getRows("chat_groups").length, 1);
  assert.equal(supabase.getRows("chat_group_members").length, 2);
});

test("extractPersonNameTokens handles invented ids, emails, and empty tokens", async () => {
  const { extractPersonNameTokens } = await import("../src/lib/chat/direct-chat.ts");

  assert.deepEqual(extractPersonNameTokens("matthew-mckillop-id"), ["matthew", "mckillop"]);
  assert.deepEqual(extractPersonNameTokens("matthew.mckillop@example.com"), [
    "matthew",
    "mckillop",
  ]);
  assert.deepEqual(extractPersonNameTokens("matthew_mckillop_id"), ["matthew", "mckillop"]);
  assert.deepEqual(extractPersonNameTokens(""), []);
  assert.deepEqual(extractPersonNameTokens("id"), []);
  assert.deepEqual(extractPersonNameTokens("123"), []);
  assert.deepEqual(extractPersonNameTokens("Matthew McKillop"), ["matthew", "mckillop"]);
});

function seedChatRecipientMember(
  supabase: ReturnType<typeof createSupabaseStub>,
  input: {
    memberId: string;
    userId: string;
    firstName: string;
    lastName: string;
    email: string;
  },
) {
  supabase.seed("user_organization_roles", [
    {
      organization_id: ORG_ID,
      user_id: input.userId,
      role: "active_member",
      status: "active",
    },
  ]);
  supabase.seed("members", [
    {
      id: input.memberId,
      organization_id: ORG_ID,
      user_id: input.userId,
      status: "active",
      deleted_at: null,
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email,
    },
  ]);
}

async function resolveChatRecipientPersonQuery(personQuery: string) {
  const supabase = createSupabaseStub();
  seedChatRecipientMember(supabase, {
    memberId: "00000000-0000-4000-8000-000000000040",
    userId: "00000000-0000-4000-8000-000000000041",
    firstName: "Matthew",
    lastName: "McKillop",
    email: "mmckillop@org.com",
  });

  return resolveChatMessageRecipient(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    personQuery,
  });
}

test("resolveChatMessageRecipient token fallback resolves invented dash id", async () => {
  const result = await resolveChatRecipientPersonQuery("matthew-mckillop-id");

  assert.deepEqual(result, {
    kind: "resolved",
    memberId: "00000000-0000-4000-8000-000000000040",
    userId: "00000000-0000-4000-8000-000000000041",
    displayName: "Matthew McKillop",
    existingChatGroupId: null,
  });
});

test("resolveChatMessageRecipient token fallback resolves invented email", async () => {
  const result = await resolveChatRecipientPersonQuery("matthew.mckillop@example.com");

  assert.deepEqual(result, {
    kind: "resolved",
    memberId: "00000000-0000-4000-8000-000000000040",
    userId: "00000000-0000-4000-8000-000000000041",
    displayName: "Matthew McKillop",
    existingChatGroupId: null,
  });
});

test("resolveChatMessageRecipient token fallback resolves invented underscore id", async () => {
  const result = await resolveChatRecipientPersonQuery("matthew_mckillop_id");

  assert.deepEqual(result, {
    kind: "resolved",
    memberId: "00000000-0000-4000-8000-000000000040",
    userId: "00000000-0000-4000-8000-000000000041",
    displayName: "Matthew McKillop",
    existingChatGroupId: null,
  });
});

test("resolveChatMessageRecipient keeps exact email match ahead of token fallback", async () => {
  const supabase = createSupabaseStub();
  seedChatRecipientMember(supabase, {
    memberId: "00000000-0000-4000-8000-000000000050",
    userId: "00000000-0000-4000-8000-000000000051",
    firstName: "Matthew",
    lastName: "McKillop",
    email: "mmckillop@org.com",
  });
  seedChatRecipientMember(supabase, {
    memberId: "00000000-0000-4000-8000-000000000052",
    userId: "00000000-0000-4000-8000-000000000053",
    firstName: "Maddie",
    lastName: "Kane",
    email: "matthew.mckillop@example.com",
  });

  const result = await resolveChatMessageRecipient(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    personQuery: "matthew.mckillop@example.com",
  });

  assert.deepEqual(result, {
    kind: "resolved",
    memberId: "00000000-0000-4000-8000-000000000052",
    userId: "00000000-0000-4000-8000-000000000053",
    displayName: "Maddie Kane",
    existingChatGroupId: null,
  });
});

test("resolveChatMessageRecipient token fallback returns not_found for unmatched tokens", async () => {
  const result = await resolveChatRecipientPersonQuery("ghost-person-id");

  assert.deepEqual(result, {
    kind: "unavailable",
    requestedRecipient: "ghost-person-id",
    reason: "recipient_not_found",
  });
});

test("resolveChatMessageRecipient token fallback returns ambiguous for multiple prefix matches", async () => {
  const supabase = createSupabaseStub();
  seedChatRecipientMember(supabase, {
    memberId: "00000000-0000-4000-8000-000000000060",
    userId: "00000000-0000-4000-8000-000000000061",
    firstName: "Matthew",
    lastName: "A",
    email: "ma@org.com",
  });
  seedChatRecipientMember(supabase, {
    memberId: "00000000-0000-4000-8000-000000000062",
    userId: "00000000-0000-4000-8000-000000000063",
    firstName: "Matthew",
    lastName: "B",
    email: "mb@org.com",
  });

  const result = await resolveChatMessageRecipient(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    personQuery: "matthew-id",
  });

  assert.deepEqual(result, {
    kind: "ambiguous",
    requestedRecipient: "matthew-id",
    candidateRecipients: ["Matthew A <ma@org.com>", "Matthew B <mb@org.com>"],
  });
});

test("resolveChatMessageRecipient numeric-only query does not vacuously match any member", async () => {
  const result = await resolveChatRecipientPersonQuery("123");

  assert.deepEqual(result, {
    kind: "unavailable",
    requestedRecipient: "123",
    reason: "recipient_not_found",
  });
});
