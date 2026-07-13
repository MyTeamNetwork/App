import { Platform } from "react-native";
import { createClient, processLock } from "@supabase/supabase-js";
import type { Database } from "@teammeet/types";
import { captureException } from "@/lib/analytics";
import { getSupabaseStorage } from "@/lib/auth-storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase credentials. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.local"
  );
}

export const authStorage = getSupabaseStorage();
export const authStorageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;

export function getAuthLockOptions(platform: typeof Platform.OS) {
  return platform === "web" ? {} : { lock: processLock };
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    storageKey: authStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web", // Enable for web to handle OAuth redirects
    flowType: "pkce",
    ...getAuthLockOptions(Platform.OS),
  },
});

export async function getSession() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/**
 * Create a Supabase Realtime channel for postgres_changes with a unique
 * topic suffix per call.
 *
 * supabase-js caches channels by topic; on rapid unmount/remount, the async
 * removeChannel may not finish before the next synchronous re-subscribe. The
 * library returns the still-subscribed cached channel, and `.on()` then throws
 * "cannot add `postgres_changes` callbacks ... after `subscribe()`". A unique
 * suffix bypasses the cache.
 */
let __pgChannelCounter = 0;
export function createPostgresChangesChannel(baseTopic: string) {
  __pgChannelCounter += 1;
  const unique = `${Date.now().toString(36)}-${__pgChannelCounter}`;
  return supabase.channel(`${baseTopic}:${unique}`);
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session?.user) {
    return null;
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", session.user.id)
    .single();

  if (error) {
    console.error("Error fetching user:", error);
    captureException(new Error(error.message), { context: "getCurrentUser" });
    return null;
  }

  return data;
}
