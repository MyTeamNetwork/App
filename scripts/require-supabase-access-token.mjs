#!/usr/bin/env node

if (!process.env.SUPABASE_ACCESS_TOKEN) {
  console.error(
    "[gen:types] FAILED: SUPABASE_ACCESS_TOKEN is required; refusing to overwrite generated types without authenticated output."
  );
  process.exit(1);
}
