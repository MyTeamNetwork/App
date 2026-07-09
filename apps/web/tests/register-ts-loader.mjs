import { register } from "node:module";

// Kill-switch (see getRpcClient in src/lib/security/rate-limit.ts): force the
// in-memory rate-limit path for the whole test process so no suite makes live
// Supabase RPC calls, even when CI injects real service-role credentials.
process.env.RATE_LIMIT_DISABLE_RPC = "1";
process.env.RATE_LIMIT_TEST_ENV = "1";

register("./ts-loader.mjs", import.meta.url);
