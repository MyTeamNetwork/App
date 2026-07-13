import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, Switch } from "react-native";
import { ChevronDown, Lock } from "lucide-react-native";
import { getBiometricCapabilities, isBiometricLockToggleDisabled } from "@/lib/biometric";
import { showToast } from "@/components/ui/Toast";
import { useBiometricLock } from "@/contexts/BiometricLockContext";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { buildSettingsColors } from "./settingsColors";
import { useBaseStyles, fontSize, fontWeight } from "./settingsShared";
import { useThemedStyles } from "@/hooks/useThemedStyles";

/**
 * Biometric unlock toggle. Hidden entirely when the device has no biometric
 * hardware (matches plan R5.1).
 */
export function SettingsSecuritySection() {
  const { disableLock, enableLock, isEnabled } = useBiometricLock();
  const { neutral, semantic } = useAppColorScheme();
  const colors = useMemo(() => buildSettingsColors(neutral, semantic), [neutral, semantic]);
  const baseStyles = useBaseStyles();

  const [hasHardware, setHasHardware] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const caps = await getBiometricCapabilities();
      if (cancelled) return;
      setHasHardware(caps.hasHardware);
      setIsEnrolled(caps.isEnrolled);
      setResolved(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const styles = useThemedStyles((n) => ({
    body: {
      paddingHorizontal: 20,
      paddingBottom: 20,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingVertical: 8,
    },
    rowLabel: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: n.foreground,
    },
    hint: {
      fontSize: fontSize.sm,
      color: n.muted,
      marginTop: 4,
    },
  }));

  if (!resolved || !hasHardware) return null;

  const handleToggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        if (!isEnrolled) {
          // Re-check in case the user enrolled since mount.
          const caps = await getBiometricCapabilities();
          setIsEnrolled(caps.isEnrolled);
          if (!caps.isEnrolled) return;
        }
        const result = await enableLock();
        if (!result.success) {
          if (!result.cancelled) {
            showToast(result.error, "error");
          }
          return;
        }
      } else {
        await disableLock();
      }
    } catch {
      showToast("Could not update biometric unlock. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={baseStyles.section}>
      <Pressable
        style={({ pressed }) => [baseStyles.sectionHeader, pressed && { opacity: 0.7 }]}
        onPress={() => setExpanded((v) => !v)}
      >
        <View style={baseStyles.sectionHeaderLeft}>
          <Lock size={20} color={colors.primary} />
          <Text style={baseStyles.sectionTitle}>Security</Text>
        </View>
        <ChevronDown
          size={20}
          color={colors.muted}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.rowLabel}>App Lock</Text>
              <Text style={styles.hint}>
                {isEnabled && !isEnrolled
                  ? "App Lock is on. Use your device credential to unlock, or turn it off here."
                  : isEnrolled
                    ? "Keep me signed in and require biometrics or my device credential when reopening TeamNetwork."
                    : "Set up biometrics in your device settings to turn on App Lock."}
              </Text>
            </View>
            <Switch
              value={isEnabled}
              onValueChange={handleToggle}
              disabled={isBiometricLockToggleDisabled({ busy, isEnrolled, isEnabled })}
            />
          </View>
        </View>
      )}
    </View>
  );
}
