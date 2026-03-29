"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Button, Select } from "@/components/ui";
import { LOCALE_NAMES } from "@/i18n/config";
import type { SupportedLocale } from "@/i18n/config";

const LANGUAGE_OPTIONS = (Object.entries(LOCALE_NAMES) as [SupportedLocale, string][]).map(
  ([value, label]) => ({ value, label })
);

export default function LanguageSettingsPage() {
  return (
    <Suspense fallback={<LanguageSettingsLoading />}>
      <LanguageSettingsContent />
    </Suspense>
  );
}

function LanguageSettingsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Language</h1>
        <p className="text-muted-foreground">
          Choose your preferred language for the app interface.
        </p>
      </div>
      <Card className="p-5 text-muted-foreground text-sm">Loading…</Card>
    </div>
  );
}

function LanguageSettingsContent() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("users")
        .select("language_override")
        .eq("id", user.id)
        .maybeSingle();

      setLanguage((data as Record<string, unknown>)?.language_override as string | null);
      setLoading(false);
    };

    load();
  }, [supabase]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { error: updateError } = await supabase
        .from("users")
        .update({ language_override: language || null } as Record<string, unknown>)
        .eq("id", user.id);

      if (updateError) throw new Error(updateError.message);

      setSuccess("Language preference saved.");

      // Refresh triggers middleware re-sync which updates the NEXT_LOCALE cookie
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save language preference");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <LanguageSettingsLoading />;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Language</h1>
        <p className="text-muted-foreground">
          Choose your preferred language for the app interface. This overrides the organization default for all orgs you belong to.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <Select
          label="Preferred Language"
          options={[
            { value: "", label: "Use organization default" },
            ...LANGUAGE_OPTIONS,
          ]}
          value={language || ""}
          onChange={(e) => { setLanguage(e.target.value || null); setSuccess(null); }}
        />

        <Button
          variant="secondary"
          size="sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save Language"}
        </Button>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
        )}
      </Card>
    </div>
  );
}
