import React, { useCallback, useMemo, forwardRef } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CalendarPlus,
  Megaphone,
  UserPlus,
  HandCoins,
  CalendarCheck,
  MapPin,
  Share2,
  ChevronRight,
  type LucideIcon,
} from "lucide-react-native";
import { SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";

interface ActionSheetProps {
  isAdmin: boolean;
  onClose: () => void;
  onCreateEvent?: () => void;
  onPostAnnouncement?: () => void;
  onInviteMember?: () => void;
  onRecordDonation?: () => void;
  onRsvpEvent?: () => void;
  onCheckIn?: () => void;
  onShareOrg?: () => void;
}

// A distinct third accent that reads well on both light and dark surfaces;
// matches the admin/role violet used elsewhere in the app.
const ACCENT_VIOLET = "#8b5cf6";

interface ActionItem {
  Icon: LucideIcon;
  label: string;
  tint: string;
  onPress: () => void;
}

export const ActionSheet = forwardRef<BottomSheet, ActionSheetProps>(
  (
    {
      isAdmin,
      onClose,
      onCreateEvent,
      onPostAnnouncement,
      onInviteMember,
      onRecordDonation,
      onRsvpEvent,
      onCheckIn,
      onShareOrg,
    },
    ref
  ) => {
    const { neutral, semantic } = useAppColorScheme();
    const insets = useSafeAreaInsets();

    const styles = useThemedStyles((n) => ({
      background: {
        backgroundColor: n.surface,
        borderTopLeftRadius: RADIUS.xxl,
        borderTopRightRadius: RADIUS.xxl,
      },
      indicator: {
        backgroundColor: n.borderStrong,
        width: 36,
      },
      content: {
        paddingHorizontal: SPACING.lg,
        paddingTop: SPACING.xs,
      },
      title: {
        ...TYPOGRAPHY.labelMedium,
        color: n.muted,
        textTransform: "uppercase" as const,
        letterSpacing: 0.8,
        marginBottom: SPACING.md,
      },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        backgroundColor: n.surfaceElevated,
        borderRadius: RADIUS.lg,
        borderCurve: "continuous" as const,
        paddingVertical: SPACING.md,
        paddingHorizontal: SPACING.md,
        marginBottom: SPACING.sm,
        gap: SPACING.md,
      },
      rowPressed: {
        opacity: 0.6,
      },
      iconBadge: {
        width: 40,
        height: 40,
        borderRadius: RADIUS.md,
        borderCurve: "continuous" as const,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      label: {
        ...TYPOGRAPHY.bodyLarge,
        color: n.foreground,
        flex: 1,
        fontWeight: "600" as const,
      },
    }));

    // Dynamic-sized sheet: content height drives the snap point, so 3 or 4
    // rows never crop and short lists don't leave a gaping sheet.
    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
        />
      ),
      []
    );

    const withClose = (fn?: () => void) => () => {
      fn?.();
      onClose();
    };

    const adminActions: ActionItem[] = [
      {
        Icon: CalendarPlus,
        label: "Create Event",
        tint: semantic.success,
        onPress: withClose(onCreateEvent),
      },
      {
        Icon: Megaphone,
        label: "Post Announcement",
        tint: semantic.info,
        onPress: withClose(onPostAnnouncement),
      },
      {
        Icon: UserPlus,
        label: "Invite Member",
        tint: ACCENT_VIOLET,
        onPress: withClose(onInviteMember),
      },
      // Apple Guideline 3.2.2(iv): no in-app contribution entry point on iOS.
      ...(Platform.OS !== "ios"
        ? [
            {
              Icon: HandCoins,
              label: "Record Contribution",
              tint: semantic.warning,
              onPress: withClose(onRecordDonation),
            },
          ]
        : []),
    ];

    const memberActions: ActionItem[] = [
      {
        Icon: CalendarCheck,
        label: "RSVP to Event",
        tint: semantic.success,
        onPress: withClose(onRsvpEvent),
      },
      {
        Icon: MapPin,
        label: "Check In",
        tint: semantic.info,
        onPress: withClose(onCheckIn),
      },
      {
        Icon: Share2,
        label: "Share Org",
        tint: semantic.warning,
        onPress: withClose(onShareOrg),
      },
    ];

    const actions = isAdmin ? adminActions : memberActions;

    const contentStyle = useMemo(
      () => [
        styles.content,
        { paddingBottom: Math.max(insets.bottom, SPACING.md) + SPACING.sm },
      ],
      [styles.content, insets.bottom]
    );

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        enableDynamicSizing
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={styles.background}
        handleIndicatorStyle={styles.indicator}
      >
        <BottomSheetView style={contentStyle}>
          <Text style={styles.title}>Quick Actions</Text>
          {actions.map((action) => (
            <Pressable
              key={action.label}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              <View
                style={[styles.iconBadge, { backgroundColor: action.tint + "22" }]}
              >
                <action.Icon size={22} color={action.tint} />
              </View>
              <Text style={styles.label}>{action.label}</Text>
              <ChevronRight size={20} color={neutral.placeholder} />
            </Pressable>
          ))}
        </BottomSheetView>
      </BottomSheet>
    );
  }
);

ActionSheet.displayName = "ActionSheet";
