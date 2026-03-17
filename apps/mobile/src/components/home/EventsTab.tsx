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

function SectionHeader({ title, onSeeAll }: { title: string; onSeeAll: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Pressable
        style={({ pressed }) => [
          styles.seeAllButton,
          pressed && { opacity: 0.7 },
        ]}
        onPress={onSeeAll}
        accessibilityRole="button"
        accessibilityLabel={`See all ${title.toLowerCase()}`}
      >
        <Text style={styles.seeAllText}>See all</Text>
        <ChevronRight size={16} color={NEUTRAL.secondary} />
      </Pressable>
    </View>
  );
}

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
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={SEMANTIC.success}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Upcoming Events section */}
      <View style={styles.section}>
        <SectionHeader
          title="Upcoming Events"
          onSeeAll={() => onNavigate(`/(app)/${orgSlug}/(tabs)/events`)}
        />

        {events.length === 0 ? (
          <View style={styles.emptyState}>
            <Calendar size={32} color={NEUTRAL.disabled} />
            <Text style={styles.emptyText}>No upcoming events</Text>
          </View>
        ) : (
          <View style={styles.cardList}>
            {events.map((event, index) => (
              <View key={event.id}>
                {index === 0 && (
                  <Text style={styles.nextUpLabel}>NEXT UP</Text>
                )}
                <EventCard
                  event={event}
                  onPress={() => handleEventPress(event.id)}
                  onRSVP={() => handleEventPress(event.id)}
                  accentColor={SEMANTIC.success}
                  style={index === 0 ? { backgroundColor: SEMANTIC.successLight } : undefined}
                />
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Recent Announcements section */}
      <View style={styles.section}>
        <SectionHeader
          title="Recent Announcements"
          onSeeAll={() => onNavigate(`/(app)/${orgSlug}/(tabs)/announcements`)}
        />

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
                style={announcement.is_pinned ? { borderLeftWidth: 3, borderLeftColor: SEMANTIC.warning } : undefined}
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
    backgroundColor: NEUTRAL.background,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: NEUTRAL.border,
  },
  emptyText: {
    ...TYPOGRAPHY.bodyMedium,
    color: NEUTRAL.muted,
  },
  nextUpLabel: {
    ...TYPOGRAPHY.overline,
    color: SEMANTIC.success,
    marginBottom: SPACING.xs,
  },
});
