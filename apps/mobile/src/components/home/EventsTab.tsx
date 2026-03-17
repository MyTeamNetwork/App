import React, { useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { Calendar, Megaphone, ChevronRight } from "lucide-react-native";
import { NEUTRAL, SEMANTIC, SPACING, RADIUS } from "@/lib/design-tokens";
import { TYPOGRAPHY } from "@/lib/typography";
import { EventCard } from "@/components/cards/EventCard";
import { AnnouncementCardCompact } from "@/components/cards/AnnouncementCard";
import type { EventCardEvent } from "@/components/cards/EventCard";
import type { AnnouncementCardAnnouncement } from "@/components/cards/AnnouncementCard";

interface EventsTabProps {
  orgSlug: string;
  events: EventCardEvent[];
  announcements: AnnouncementCardAnnouncement[];
  refreshing: boolean;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
}

export function EventsTab({
  orgSlug,
  events,
  announcements,
  refreshing,
  onRefresh,
  onNavigate,
}: EventsTabProps) {
  const handleEventPress = useCallback(
    (eventId: string) => onNavigate(`/(app)/${orgSlug}/events/${eventId}`),
    [onNavigate, orgSlug]
  );

  const handleAnnouncementPress = useCallback(
    (announcementId: string) => onNavigate(`/(app)/${orgSlug}/announcements/${announcementId}`),
    [onNavigate, orgSlug]
  );

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Upcoming Events section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Upcoming Events</Text>
          <Pressable
            style={({ pressed }) => [
              styles.seeAllButton,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() => onNavigate(`/(app)/${orgSlug}/(tabs)/events`)}
            accessibilityRole="button"
            accessibilityLabel="See all events"
          >
            <Text style={styles.seeAllText}>See all</Text>
            <ChevronRight size={16} color={NEUTRAL.secondary} />
          </Pressable>
        </View>

        {events.length === 0 ? (
          <View style={styles.emptyState}>
            <Calendar size={32} color={NEUTRAL.disabled} />
            <Text style={styles.emptyText}>No upcoming events</Text>
          </View>
        ) : (
          <View style={styles.cardList}>
            {events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                onPress={() => handleEventPress(event.id)}
                onRSVP={() => handleEventPress(event.id)}
                accentColor={SEMANTIC.success}
              />
            ))}
          </View>
        )}
      </View>

      {/* Recent Announcements section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Announcements</Text>
          <Pressable
            style={({ pressed }) => [
              styles.seeAllButton,
              pressed && { opacity: 0.7 },
            ]}
            onPress={() =>
              onNavigate(`/(app)/${orgSlug}/(tabs)/announcements`)
            }
            accessibilityRole="button"
            accessibilityLabel="See all announcements"
          >
            <Text style={styles.seeAllText}>See all</Text>
            <ChevronRight size={16} color={NEUTRAL.secondary} />
          </Pressable>
        </View>

        {announcements.length === 0 ? (
          <View style={styles.emptyState}>
            <Megaphone size={32} color={NEUTRAL.disabled} />
            <Text style={styles.emptyText}>No announcements</Text>
          </View>
        ) : (
          <View style={styles.cardList}>
            {announcements.map((announcement) => (
              <AnnouncementCardCompact
                key={announcement.id}
                announcement={announcement}
                onPress={() => handleAnnouncementPress(announcement.id)}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
    gap: SPACING.lg,
  },
  section: {
    gap: SPACING.sm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    ...TYPOGRAPHY.titleLarge,
    color: NEUTRAL.foreground,
  },
  seeAllButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xxs,
  },
  seeAllText: {
    ...TYPOGRAPHY.labelMedium,
    color: NEUTRAL.secondary,
  },
  cardList: {
    gap: SPACING.sm,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: SPACING.xl,
    gap: SPACING.sm,
    backgroundColor: NEUTRAL.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: NEUTRAL.border,
  },
  emptyText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.muted,
  },
});
