import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  FlatList,
  Switch,
  Alert,
  Platform,
  Linking,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DrawerActions } from "@react-navigation/native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation } from "expo-router";
import { ChevronDown, Trash2 } from "lucide-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOrg } from "@/contexts/OrgContext";
import { useOrgRole } from "@/hooks/useOrgRole";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from "@/lib/web-api";
import { APP_CHROME } from "@/lib/chrome";
import { spacing, borderRadius, fontSize, fontWeight } from "@/lib/theme";
import { useAppColorScheme } from "@/contexts/ColorSchemeContext";
import { formatDefaultDate, formatDefaultDateFromString } from "@/lib/date-format";
import type { MentorshipLog, MentorshipPair, User } from "@teammeet/types";
import {
  MENTORSHIP_MENTEE_ROLES,
  MENTORSHIP_MENTOR_ROLES,
  getMentorshipSectionOrder,
  getVisibleMentorshipPairs,
  isUserInMentorshipPair,
  memberDisplayLabel,
  normalizeMentorshipStatus,
  partitionPairableOrgMembers,
  type PairableOrgMemberRow,
} from "@teammeet/core";

// Fixed color palette
const MENTORSHIP_COLORS = {
  background: "#f8fafc",
  primaryText: "#0f172a",
  secondaryText: "#64748b",
  mutedText: "#94a3b8",
  mutedForeground: "#94a3b8",
  border: "#e2e8f0",
  card: "#ffffff",
  mutedSurface: "#f1f5f9",
  primary: "#059669",
  primaryForeground: "#ffffff",
  primaryLight: "#10b981",
  error: "#ef4444",
  success: "#22c55e",
  warning: "#f59e0b",
};

type SelectOption = { value: string; label: string };
type MentorshipStatus = "active" | "paused" | "completed";
type MentorDirectoryEntry = {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  photo_url: string | null;
  industry: string | null;
  graduation_year: number | null;
  current_company: string | null;
  current_city: string | null;
  expertise_areas: string[] | null;
  bio: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  contact_phone: string | null;
};
type MentorProfileRecord = {
  id: string;
  bio: string | null;
  expertise_areas: string[];
  contact_email: string | null;
  contact_linkedin: string | null;
  contact_phone: string | null;
  is_active: boolean;
  organization_id: string;
  user_id: string;
};

const STATUS_OPTIONS: SelectOption[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
];

async function loadPairableOrgMembers(orgId: string) {
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("user_id, role, users(name, email)")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .in("role", [...MENTORSHIP_MENTOR_ROLES, ...MENTORSHIP_MENTEE_ROLES]);

  if (error) {
    throw new Error(`Failed to load pairable org members: ${error.message}`);
  }

  return partitionPairableOrgMembers((data ?? []) as PairableOrgMemberRow[]);
}

export default function MentorshipScreen() {
  const { orgId, orgName, orgLogoUrl } = useOrg();
  const { user } = useAuth();
  const { role, isAdmin, isActiveMember, isAlumni, isLoading: roleLoading } = useOrgRole();
  const navigation = useNavigation();
  const { neutral } = useAppColorScheme();
  const styles = useMemo(() => createStyles(neutral.surface), [neutral.surface]);
  const isMountedRef = useRef(true);

  // Safe drawer toggle - only dispatch if drawer is available
  const handleDrawerToggle = useCallback(() => {
    try {
      if (navigation && typeof (navigation as any).dispatch === "function") {
        (navigation as any).dispatch(DrawerActions.toggleDrawer());
      }
    } catch {
      // Drawer not available - no-op
    }
  }, [navigation]);
  const [pairs, setPairs] = useState<MentorshipPair[]>([]);
  const [logs, setLogs] = useState<MentorshipLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [mentorDirectory, setMentorDirectory] = useState<MentorDirectoryEntry[]>([]);
  const [mentorIndustries, setMentorIndustries] = useState<string[]>([]);
  const [mentorYears, setMentorYears] = useState<number[]>([]);
  const [currentUserMentorProfile, setCurrentUserMentorProfile] = useState<MentorProfileRecord | null>(null);
  const [archivedPairIds, setArchivedPairIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMentorshipData = useCallback(
    async (isRefresh = false) => {
      if (!orgId) {
        if (isMountedRef.current) {
          setPairs([]);
          setLogs([]);
          setUsers([]);
          setMentorDirectory([]);
          setMentorIndustries([]);
          setMentorYears([]);
          setCurrentUserMentorProfile(null);
          setArchivedPairIds([]);
          setLoading(false);
          setRefreshing(false);
          setError(null);
        }
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [
          { data: pairsData, error: pairsError },
          { data: currentUserProfileData, error: currentUserProfileError },
          { data: mentorProfilesData, error: mentorProfilesError },
        ] = await Promise.all([
          supabase
            .from("mentorship_pairs")
            .select("*")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .order("created_at", { ascending: false }),
          user?.id
            ? supabase
                .from("mentor_profiles")
                .select("*")
                .eq("organization_id", orgId)
                .eq("user_id", user.id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          supabase
            .from("mentor_profiles")
            .select("*, users!mentor_profiles_user_id_fkey(id, name, email)")
            .eq("organization_id", orgId)
            .eq("is_active", true),
        ]);

        if (pairsError) throw pairsError;
        if (currentUserProfileError) throw currentUserProfileError;
        if (mentorProfilesError) throw mentorProfilesError;

        const pairIds = (pairsData || []).map((pair) => pair.id);
        const mentorUserIds = (mentorProfilesData || []).map((profile) => profile.user_id);

        const userIds = new Set<string>();
        (pairsData || []).forEach((pair) => {
          if (pair.mentor_user_id) userIds.add(pair.mentor_user_id);
          if (pair.mentee_user_id) userIds.add(pair.mentee_user_id);
        });

        const [
          { data: logsData, error: logsError },
          { data: usersData, error: usersError },
          { data: mentorAlumniData, error: mentorAlumniError },
        ] = await Promise.all([
          pairIds.length
            ? supabase
                .from("mentorship_logs")
                .select("*")
                .eq("organization_id", orgId)
                .is("deleted_at", null)
                .in("pair_id", pairIds)
                .order("entry_date", { ascending: false })
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [] as MentorshipLog[], error: null }),
          userIds.size
            ? supabase
                .from("users")
                .select("id, name, email")
                .in("id", Array.from(userIds))
            : Promise.resolve({ data: [] as User[], error: null }),
          mentorUserIds.length
            ? supabase
                .from("alumni")
                .select(
                  "user_id, first_name, last_name, photo_url, industry, graduation_year, current_company, current_city"
                )
                .eq("organization_id", orgId)
                .is("deleted_at", null)
                .in("user_id", mentorUserIds)
            : Promise.resolve({ data: [] as any[], error: null }),
        ]);

        if (usersError) throw usersError;
        if (logsError) throw logsError;
        if (mentorAlumniError) throw mentorAlumniError;

        const alumniMap = new Map(
          (mentorAlumniData || []).map((alumni) => [alumni.user_id, alumni])
        );

        const mentorsForDirectory: MentorDirectoryEntry[] = (mentorProfilesData || []).map(
          (profile) => {
            const profileUser = Array.isArray(profile.users) ? profile.users[0] : profile.users;
            const alumni = alumniMap.get(profile.user_id);

            return {
              id: profile.id,
              user_id: profile.user_id,
              name: profileUser?.name || "Unknown",
              email: profileUser?.email || null,
              photo_url: alumni?.photo_url || null,
              industry: alumni?.industry || null,
              graduation_year: alumni?.graduation_year || null,
              current_company: alumni?.current_company || null,
              current_city: alumni?.current_city || null,
              expertise_areas: profile.expertise_areas || null,
              bio: profile.bio || null,
              contact_email: profile.contact_email || null,
              contact_linkedin: profile.contact_linkedin || null,
              contact_phone: profile.contact_phone || null,
            };
          }
        );

        const industries = Array.from(
          new Set(
            mentorsForDirectory
              .map((mentor) => mentor.industry)
              .filter((industry): industry is string => industry !== null)
          )
        ).sort();

        const years = Array.from(
          new Set(
            mentorsForDirectory
              .map((mentor) => mentor.graduation_year)
              .filter((year): year is number => year !== null)
          )
        ).sort((a, b) => b - a);

        if (isMountedRef.current) {
          setPairs((pairsData || []) as MentorshipPair[]);
          setLogs((logsData || []) as MentorshipLog[]);
          setUsers((usersData || []) as User[]);
          setMentorDirectory(mentorsForDirectory);
          setMentorIndustries(industries);
          setMentorYears(years);
          setCurrentUserMentorProfile((currentUserProfileData as MentorProfileRecord | null) ?? null);
          setArchivedPairIds((current) =>
            current.filter((pairId) => (pairsData || []).some((pair) => pair.id === pairId))
          );
          setError(null);
        }
      } catch (fetchError) {
        if (isMountedRef.current) {
          setError((fetchError as Error).message || "Failed to load mentorship data.");
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [orgId, user?.id]
  );

  useEffect(() => {
    isMountedRef.current = true;
    loadMentorshipData();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadMentorshipData]);

  const handleRefresh = useCallback(() => loadMentorshipData(true), [loadMentorshipData]);

  const filteredPairs = useMemo(() => {
    if (isAdmin) return pairs;
    if (!user?.id) return [];
    if (role === "active_member") {
      return pairs.filter((pair) => pair.mentee_user_id === user.id);
    }
    if (role === "alumni") {
      return pairs.filter((pair) => pair.mentor_user_id === user.id);
    }
    return [];
  }, [pairs, isAdmin, role, user?.id]);
  const visibleFilteredPairs = useMemo(
    () => getVisibleMentorshipPairs(filteredPairs, archivedPairIds),
    [filteredPairs, archivedPairIds]
  );

  const userMap = useMemo(() => {
    const map: Record<string, string> = {};
    users.forEach((u) => {
      map[u.id] = u.name || u.email || "Unknown";
    });
    return map;
  }, [users]);

  const userLabel = useCallback((id: string) => userMap[id] || "Unknown", [userMap]);

  const logsByPair = useMemo(() => {
    return logs.reduce((acc, log) => {
      if (!acc[log.pair_id]) {
        acc[log.pair_id] = [];
      }
      acc[log.pair_id].push(log);
      return acc;
    }, {} as Record<string, MentorshipLog[]>);
  }, [logs]);

  const myPair = useMemo(() => {
    if (role !== "active_member" || !user?.id) {
      return null;
    }

    return filteredPairs.find((pair) => pair.mentee_user_id === user.id) ?? null;
  }, [filteredPairs, role, user?.id]);

  const myMentorName = myPair ? userLabel(myPair.mentor_user_id) : null;
  const myLastLogDate = myPair ? logsByPair[myPair.id]?.[0]?.entry_date ?? null : null;
  const sectionOrder = getMentorshipSectionOrder({
    hasPairs: visibleFilteredPairs.length > 0,
    isAdmin,
  });
  const showDirectory = Boolean(orgId);

  const showLoading = (loading || roleLoading) && pairs.length === 0;

  if (showLoading) {
    return (
      <View style={styles.container}>
        {/* Custom Gradient Header */}
        <LinearGradient
          colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
          style={styles.headerGradient}
        >
          <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
            <View style={styles.headerContent}>
              <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
                {orgLogoUrl ? (
                  <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
                ) : (
                  <View style={styles.orgAvatar}>
                    <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                  </View>
                )}
              </Pressable>
              <View style={styles.headerTextContainer}>
                <Text style={styles.headerTitle}>Mentorship</Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        {/* Content Sheet */}
        <View style={styles.contentSheet}>
          <View style={styles.stateContainer}>
            <ActivityIndicator color={MENTORSHIP_COLORS.primary} />
            <Text style={styles.stateText}>Loading mentorship...</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Custom Gradient Header */}
      <LinearGradient
        colors={[APP_CHROME.gradientStart, APP_CHROME.gradientEnd]}
        style={styles.headerGradient}
      >
        <SafeAreaView edges={["top"]} style={styles.headerSafeArea}>
          <View style={styles.headerContent}>
            <Pressable onPress={handleDrawerToggle} style={styles.orgLogoButton}>
              {orgLogoUrl ? (
                <Image source={orgLogoUrl} style={styles.orgLogo} contentFit="contain" transition={200} />
              ) : (
                <View style={styles.orgAvatar}>
                  <Text style={styles.orgAvatarText}>{orgName?.[0]}</Text>
                </View>
              )}
            </Pressable>
            <View style={styles.headerTextContainer}>
              <Text style={styles.headerTitle}>Mentorship</Text>
              <Text style={styles.headerMeta}>
                {visibleFilteredPairs.length} {visibleFilteredPairs.length === 1 ? "pair" : "pairs"}
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </LinearGradient>

      {/* Content Sheet */}
      <View style={styles.contentSheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={MENTORSHIP_COLORS.primary}
            />
          }
          keyboardShouldPersistTaps="handled"
        >

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                onPress={handleRefresh}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.retryButtonPressed,
                ]}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {isActiveMember && orgId ? (
            <ActiveMemberMentorshipSummary
              myMentorName={myMentorName}
              myLastLogDate={myLastLogDate}
              styles={styles}
            />
          ) : null}

          {isActiveMember && orgId ? (
            <MenteeStatusToggle orgId={orgId} styles={styles} />
          ) : null}

          {isAdmin && orgId ? (
            <MentorshipAdminPanel
              orgId={orgId}
              styles={styles}
              onRefresh={handleRefresh}
            />
          ) : null}

          {!isAdmin && isAlumni && orgId ? (
            <MentorPairManager
              orgId={orgId}
              styles={styles}
              onRefresh={handleRefresh}
            />
          ) : null}

          {showDirectory && sectionOrder === "directory-first" ? (
            <MentorDirectorySection
              mentors={mentorDirectory}
              industries={mentorIndustries}
              years={mentorYears}
              showRegistration={isAlumni}
              currentUserProfile={currentUserMentorProfile}
              styles={styles}
              onRefresh={handleRefresh}
            />
          ) : null}

          {orgId ? (
            <MentorshipPairsList
              pairs={visibleFilteredPairs}
              logsByPair={logsByPair}
              userLabel={userLabel}
              isAdmin={isAdmin}
              canLogActivity={isAdmin || isActiveMember}
              orgId={orgId}
              userId={user?.id ?? null}
              styles={styles}
              onRefresh={handleRefresh}
              onArchive={(pairId) =>
                setArchivedPairIds((current) =>
                  current.includes(pairId) ? current : [...current, pairId]
                )
              }
            />
          ) : null}

          {showDirectory && sectionOrder === "pairs-first" ? (
            <MentorDirectorySection
              mentors={mentorDirectory}
              industries={mentorIndustries}
              years={mentorYears}
              showRegistration={isAlumni}
              currentUserProfile={currentUserMentorProfile}
              styles={styles}
              onRefresh={handleRefresh}
            />
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function ActiveMemberMentorshipSummary({
  myMentorName,
  myLastLogDate,
  styles,
}: {
  myMentorName: string | null;
  myLastLogDate: string | null;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {myMentorName ? `My mentor: ${myMentorName}` : "Looking for a mentor"}
        </Text>
        <Text style={styles.sectionSubtitle}>
          {myLastLogDate
            ? `Last session: ${formatDefaultDateFromString(myLastLogDate)}`
            : "Browse the mentor directory below to find alumni willing to help."}
        </Text>
      </View>
    </View>
  );
}

function MentorDirectorySection({
  mentors,
  industries,
  years,
  showRegistration,
  currentUserProfile,
  styles,
  onRefresh,
}: {
  mentors: MentorDirectoryEntry[];
  industries: string[];
  years: number[];
  showRegistration: boolean;
  currentUserProfile: MentorProfileRecord | null;
  styles: ReturnType<typeof createStyles>;
  onRefresh: () => void;
}) {
  const [filters, setFilters] = useState({
    nameSearch: "",
    industry: "",
    year: "",
  });
  const [activeSelect, setActiveSelect] = useState<"industry" | "year" | null>(null);
  const [showProfileForm, setShowProfileForm] = useState(false);

  const filteredMentors = useMemo(() => {
    const nameQuery = filters.nameSearch.trim().toLowerCase();
    return mentors.filter((mentor) => {
      if (nameQuery && !mentor.name.toLowerCase().includes(nameQuery)) {
        return false;
      }
      if (filters.industry && mentor.industry !== filters.industry) {
        return false;
      }
      if (filters.year && mentor.graduation_year?.toString() !== filters.year) {
        return false;
      }
      return true;
    });
  }, [filters, mentors]);

  const hasActiveFilters =
    filters.nameSearch !== "" || filters.industry !== "" || filters.year !== "";

  const industryOptions: SelectOption[] = [
    { value: "", label: "All industries" },
    ...industries.map((industry) => ({ value: industry, label: industry })),
  ];
  const yearOptions: SelectOption[] = [
    { value: "", label: "All years" },
    ...years.map((year) => ({ value: year.toString(), label: `Class of ${year}` })),
  ];

  const clearFilters = () => {
    setFilters({
      nameSearch: "",
      industry: "",
      year: "",
    });
  };

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Willing to Help</Text>
        <Text style={styles.sectionSubtitle}>
          Browse alumni who have raised their hand to mentor and share their expertise.
        </Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Search mentors</Text>
        <TextInput
          value={filters.nameSearch}
          onChangeText={(nameSearch) => setFilters((current) => ({ ...current, nameSearch }))}
          placeholder="Search by name"
          placeholderTextColor={MENTORSHIP_COLORS.secondaryText}
          style={styles.input}
        />
      </View>

      <View style={styles.directoryFilterRow}>
        <View style={styles.directoryFilterField}>
          <SelectField
            label="Industry"
            value={industryOptions.find((option) => option.value === filters.industry)?.label || ""}
            placeholder="All industries"
            onPress={() => setActiveSelect("industry")}
            styles={styles}
          />
        </View>
        <View style={styles.directoryFilterField}>
          <SelectField
            label="Graduation year"
            value={yearOptions.find((option) => option.value === filters.year)?.label || ""}
            placeholder="All years"
            onPress={() => setActiveSelect("year")}
            styles={styles}
          />
        </View>
      </View>

      {hasActiveFilters ? (
        <Pressable
          onPress={clearFilters}
          style={({ pressed }) => [
            styles.inlineLinkButton,
            pressed && styles.inlineLinkButtonPressed,
          ]}
        >
          <Text style={styles.inlineLinkText}>Clear filters</Text>
        </Pressable>
      ) : null}

      {showRegistration && !showProfileForm ? (
        <View style={styles.directoryCallout}>
          <View style={styles.directoryCalloutBody}>
            <Text style={styles.calloutTitle}>
              {currentUserProfile ? "Update your mentor profile" : "Want to give back?"}
            </Text>
            <Text style={styles.calloutSubtitle}>
              {currentUserProfile
                ? "Keep your mentor profile current so members can find you."
                : "Join the directory and help current members with your expertise."}
            </Text>
          </View>
          <Pressable
            onPress={() => setShowProfileForm(true)}
            style={({ pressed }) => [
              styles.primaryButton,
              styles.calloutButton,
              pressed && styles.primaryButtonPressed,
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {currentUserProfile ? "Edit profile" : "Become a mentor"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showRegistration && showProfileForm ? (
        <MentorProfileForm
          currentUserProfile={currentUserProfile}
          styles={styles}
          onCancel={() => setShowProfileForm(false)}
          onSaved={() => {
            setShowProfileForm(false);
            onRefresh();
          }}
        />
      ) : null}

      {filteredMentors.length === 0 ? (
        <View style={styles.directoryEmptyState}>
          <Text style={styles.emptyTitle}>
            {hasActiveFilters ? "No mentors found" : "No mentors yet"}
          </Text>
          <Text style={styles.emptySubtitle}>
            {hasActiveFilters
              ? "Try adjusting your filters to see more results."
              : showRegistration
                ? "Be the first mentor in the directory for this organization."
                : "Check back later as alumni register to help."}
          </Text>
        </View>
      ) : (
        <View style={styles.directoryList}>
          {filteredMentors.map((mentor) => (
            <View key={mentor.id} style={styles.directoryCard}>
              <View style={styles.directoryCardHeader}>
                {mentor.photo_url ? (
                  <Image
                    source={mentor.photo_url}
                    style={styles.directoryAvatar}
                    contentFit="cover"
                    transition={200}
                  />
                ) : (
                  <View style={styles.directoryAvatarFallback}>
                    <Text style={styles.directoryAvatarFallbackText}>
                      {mentor.name[0] ?? "M"}
                    </Text>
                  </View>
                )}
                <View style={styles.directoryHeaderText}>
                  <Text style={styles.directoryName}>{mentor.name}</Text>
                  <Text style={styles.directoryMeta}>
                    {[mentor.current_company, mentor.current_city].filter(Boolean).join(" · ") || "Mentor"}
                  </Text>
                </View>
              </View>

              <View style={styles.directoryBadgeRow}>
                {mentor.industry ? (
                  <View style={styles.directoryBadge}>
                    <Text style={styles.directoryBadgeText}>{mentor.industry}</Text>
                  </View>
                ) : null}
                {mentor.graduation_year ? (
                  <View style={styles.directoryBadge}>
                    <Text style={styles.directoryBadgeText}>
                      Class of {mentor.graduation_year}
                    </Text>
                  </View>
                ) : null}
              </View>

              {mentor.bio ? (
                <Text style={styles.directoryBio}>{mentor.bio}</Text>
              ) : null}

              {mentor.expertise_areas?.length ? (
                <Text style={styles.directoryExpertise}>
                  Expertise: {mentor.expertise_areas.join(", ")}
                </Text>
              ) : null}

              <View style={styles.directoryContactRow}>
                {mentor.contact_email ? (
                  <Pressable
                    onPress={() => void Linking.openURL(`mailto:${mentor.contact_email}`)}
                    style={({ pressed }) => [
                      styles.contactButton,
                      pressed && styles.contactButtonPressed,
                    ]}
                  >
                    <Text style={styles.contactButtonText}>Email</Text>
                  </Pressable>
                ) : null}
                {mentor.contact_linkedin ? (
                  <Pressable
                    onPress={() =>
                      void Linking.openURL(
                        mentor.contact_linkedin?.startsWith("http")
                          ? mentor.contact_linkedin
                          : `https://${mentor.contact_linkedin}`
                      )
                    }
                    style={({ pressed }) => [
                      styles.contactButton,
                      pressed && styles.contactButtonPressed,
                    ]}
                  >
                    <Text style={styles.contactButtonText}>LinkedIn</Text>
                  </Pressable>
                ) : null}
                {mentor.contact_phone ? (
                  <Pressable
                    onPress={() => void Linking.openURL(`tel:${mentor.contact_phone}`)}
                    style={({ pressed }) => [
                      styles.contactButton,
                      pressed && styles.contactButtonPressed,
                    ]}
                  >
                    <Text style={styles.contactButtonText}>Call</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}

      <SelectModal
        visible={activeSelect === "industry"}
        title="Choose industry"
        options={industryOptions}
        selectedValue={filters.industry}
        onSelect={(option) => {
          setFilters((current) => ({ ...current, industry: option.value }));
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
        styles={styles}
      />
      <SelectModal
        visible={activeSelect === "year"}
        title="Choose graduation year"
        options={yearOptions}
        selectedValue={filters.year}
        onSelect={(option) => {
          setFilters((current) => ({ ...current, year: option.value }));
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
        styles={styles}
      />
    </View>
  );
}

function MentorProfileForm({
  currentUserProfile,
  styles,
  onCancel,
  onSaved,
}: {
  currentUserProfile: MentorProfileRecord | null;
  styles: ReturnType<typeof createStyles>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const { orgId } = useOrg();
  const [bio, setBio] = useState(currentUserProfile?.bio ?? "");
  const [expertiseAreas, setExpertiseAreas] = useState(
    currentUserProfile?.expertise_areas.join(", ") ?? ""
  );
  const [contactEmail, setContactEmail] = useState(currentUserProfile?.contact_email ?? "");
  const [contactLinkedin, setContactLinkedin] = useState(
    currentUserProfile?.contact_linkedin ?? ""
  );
  const [contactPhone, setContactPhone] = useState(currentUserProfile?.contact_phone ?? "");
  const [isActive, setIsActive] = useState(currentUserProfile?.is_active ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!user?.id || !orgId) {
      setError("You must be signed in to update your mentor profile.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const payload = {
      organization_id: orgId,
      user_id: user.id,
      bio: bio.trim() || null,
      expertise_areas: expertiseAreas
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      contact_email: contactEmail.trim() || null,
      contact_linkedin: contactLinkedin.trim() || null,
      contact_phone: contactPhone.trim() || null,
      is_active: isActive,
    };

    const query = currentUserProfile
      ? supabase
          .from("mentor_profiles")
          .update(payload)
          .eq("id", currentUserProfile.id)
          .eq("user_id", user.id)
      : supabase.from("mentor_profiles").insert(payload);

    const { error: saveError } = await query;

    if (saveError) {
      setError(saveError.message);
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    onSaved();
  };

  return (
    <View style={styles.profileFormCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {currentUserProfile ? "Edit mentor profile" : "Become a mentor"}
        </Text>
        <Text style={styles.sectionSubtitle}>
          Share what you can help with so current members know how to reach you.
        </Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Bio</Text>
        <TextInput
          value={bio}
          onChangeText={setBio}
          placeholder="Tell members about your background and what you can help with."
          placeholderTextColor={MENTORSHIP_COLORS.secondaryText}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Areas of expertise</Text>
        <TextInput
          value={expertiseAreas}
          onChangeText={setExpertiseAreas}
          placeholder="Career advice, interview prep, industry insights"
          placeholderTextColor={MENTORSHIP_COLORS.secondaryText}
          style={styles.input}
        />
        <Text style={styles.helperText}>Separate multiple areas with commas.</Text>
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Email</Text>
        <TextInput
          value={contactEmail}
          onChangeText={setContactEmail}
          placeholder="your.email@example.com"
          placeholderTextColor={MENTORSHIP_COLORS.secondaryText}
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>LinkedIn URL</Text>
        <TextInput
          value={contactLinkedin}
          onChangeText={setContactLinkedin}
          placeholder="https://linkedin.com/in/yourprofile"
          placeholderTextColor={MENTORSHIP_COLORS.secondaryText}
          autoCapitalize="none"
          style={styles.input}
        />
      </View>

      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Phone</Text>
        <TextInput
          value={contactPhone}
          onChangeText={setContactPhone}
          placeholder="+1 (555) 123-4567"
          placeholderTextColor={MENTORSHIP_COLORS.secondaryText}
          keyboardType="phone-pad"
          style={styles.input}
        />
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Visible in directory</Text>
        <Switch
          value={isActive}
          onValueChange={setIsActive}
          trackColor={{ false: MENTORSHIP_COLORS.border, true: MENTORSHIP_COLORS.primaryLight }}
          thumbColor={isActive ? MENTORSHIP_COLORS.primary : MENTORSHIP_COLORS.card}
        />
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [
            styles.ghostButton,
            pressed && styles.ghostButtonPressed,
          ]}
        >
          <Text style={styles.ghostButtonText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            isSaving && styles.buttonDisabled,
          ]}
        >
          {isSaving ? (
            <ActivityIndicator color={MENTORSHIP_COLORS.primaryForeground} />
          ) : (
            <Text style={styles.primaryButtonText}>
              {currentUserProfile ? "Save profile" : "Register as mentor"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function MenteeStatusToggle({
  orgId,
  styles,
}: {
  orgId: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const { user } = useAuth();
  const [status, setStatus] = useState<"active" | "revoked" | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      if (!orgId || !user) {
        if (isMounted) {
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      const { data: membership, error: fetchError } = await supabase
        .from("user_organization_roles")
        .select("status, role")
        .eq("organization_id", orgId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (!isMounted) return;

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      if (!membership || membership.role !== "active_member") {
        setError("Only active members can change mentee availability.");
        setLoading(false);
        return;
      }

      setStatus((membership.status as "active" | "revoked") ?? "active");
      setLoading(false);
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [orgId, user]);

  const handleToggle = async () => {
    if (!status || !user) {
      setError("Unable to update availability right now.");
      return;
    }
    const nextStatus = status === "active" ? "revoked" : "active";
    setSaving(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("user_organization_roles")
      .update({ status: nextStatus })
      .eq("organization_id", orgId)
      .eq("user_id", user.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setStatus(nextStatus);
    setSaving(false);
  };

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Mentee availability</Text>
        <Text style={styles.sectionSubtitle}>
          Toggle whether you are available as an active member mentee.
        </Text>
      </View>
      {loading ? (
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={MENTORSHIP_COLORS.primary} />
          <Text style={styles.inlineLoadingText}>Checking availability...</Text>
        </View>
      ) : (
        <>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>
              {status === "active" ? "Currently available" : "Currently not available"}
            </Text>
            <Switch
              value={status === "active"}
              onValueChange={handleToggle}
              disabled={saving}
              trackColor={{ false: MENTORSHIP_COLORS.border, true: MENTORSHIP_COLORS.primaryLight }}
              thumbColor={status === "active" ? MENTORSHIP_COLORS.primary : MENTORSHIP_COLORS.card}
            />
          </View>
        </>
      )}
    </View>
  );
}

function MentorshipAdminPanel({
  orgId,
  styles,
  onRefresh,
}: {
  orgId: string;
  styles: ReturnType<typeof createStyles>;
  onRefresh: () => void;
}) {
  const [mentors, setMentors] = useState<SelectOption[]>([]);
  const [mentees, setMentees] = useState<SelectOption[]>([]);
  const [mentorId, setMentorId] = useState<string | null>(null);
  const [menteeId, setMenteeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSelect, setActiveSelect] = useState<"mentor" | "mentee" | null>(null);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { mentors: mentorList, mentees: menteeList } =
          await loadPairableOrgMembers(orgId);

        if (!isMounted) return;

        setMentors(
          mentorList.map((member) => ({
            value: member.user_id,
            label: memberDisplayLabel(member),
          }))
        );
        setMentees(
          menteeList.map((member) => ({
            value: member.user_id,
            label: memberDisplayLabel(member),
          }))
        );
      } catch (loadError) {
        if (!isMounted) return;
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load org members."
        );
      }

      setIsLoading(false);
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [orgId]);

  const handleCreate = async () => {
    if (!mentorId || !menteeId) {
      setError("Select both a mentor and mentee.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("mentorship_pairs").insert({
      organization_id: orgId,
      mentor_user_id: mentorId,
      mentee_user_id: menteeId,
      status: "active",
    });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    const mentorLabel = mentors.find((m) => m.value === mentorId)?.label || "Mentor";
    const menteeLabel = mentees.find((m) => m.value === menteeId)?.label || "Mentee";

    try {
      const response = await fetchWithAuth("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: orgId,
          title: "New Mentorship Pairing",
          body: `You've been paired for mentorship.\n\nMentor: ${mentorLabel}\nMentee: ${menteeLabel}`,
          channel: "both",
          audience: "both",
          targetUserIds: [mentorId, menteeId],
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.warn("Failed to send mentorship pairing notification:", payload?.error || response.status);
      }
    } catch (notifError) {
      console.warn("Failed to send mentorship pairing notification:", notifError);
    }

    setIsSaving(false);
    setMentorId(null);
    setMenteeId(null);
    onRefresh();
  };

  if (isLoading) {
    return (
      <View style={styles.card}>
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={MENTORSHIP_COLORS.primary} />
          <Text style={styles.inlineLoadingText}>Loading mentorship controls...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Create pair</Text>
        <Text style={styles.sectionSubtitle}>
          Pair an eligible mentor with an active member.
        </Text>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <SelectField
        label="Mentor"
        value={mentors.find((m) => m.value === mentorId)?.label || ""}
        placeholder="Select mentor"
        onPress={() => setActiveSelect("mentor")}
        styles={styles}
      />
      <SelectField
        label="Mentee"
        value={mentees.find((m) => m.value === menteeId)?.label || ""}
        placeholder="Select mentee"
        onPress={() => setActiveSelect("mentee")}
        styles={styles}
      />
      <Pressable
        onPress={handleCreate}
        disabled={isSaving}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          isSaving && styles.buttonDisabled,
        ]}
      >
        {isSaving ? (
          <ActivityIndicator color={MENTORSHIP_COLORS.primaryForeground} />
        ) : (
          <Text style={styles.primaryButtonText}>Create pair</Text>
        )}
      </Pressable>

      <SelectModal
        visible={activeSelect === "mentor"}
        title="Select mentor"
        options={mentors}
        selectedValue={mentorId}
        onSelect={(option) => {
          setMentorId(option.value);
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
        styles={styles}
      />
      <SelectModal
        visible={activeSelect === "mentee"}
        title="Select mentee"
        options={mentees}
        selectedValue={menteeId}
        onSelect={(option) => {
          setMenteeId(option.value);
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
        styles={styles}
      />
    </View>
  );
}

function MentorPairManager({
  orgId,
  styles,
  onRefresh,
}: {
  orgId: string;
  styles: ReturnType<typeof createStyles>;
  onRefresh: () => void;
}) {
  const { user } = useAuth();
  const [mentorId, setMentorId] = useState<string | null>(null);
  const [pairId, setPairId] = useState<string | null>(null);
  const [currentMenteeId, setCurrentMenteeId] = useState<string | null>(null);
  const [initialMenteeId, setInitialMenteeId] = useState<string | null>(null);
  const [availableMentees, setAvailableMentees] = useState<SelectOption[]>([]);
  const [status, setStatus] = useState<MentorshipStatus>("active");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSelect, setActiveSelect] = useState<"mentee" | "status" | null>(null);
  const mentorLabel =
    (user?.user_metadata as { name?: string } | undefined)?.name ||
    user?.email ||
    "Mentor";

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (!user) {
        setError("You must be signed in to manage your pair.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setMentorId(user.id);

      try {
        const { mentees: menteeList } = await loadPairableOrgMembers(orgId);

        if (!isMounted) return;

        setAvailableMentees(
          menteeList.map((member) => ({
            value: member.user_id,
            label: memberDisplayLabel(member),
          }))
        );
      } catch (loadError) {
        if (!isMounted) return;
        setError(
          loadError instanceof Error ? loadError.message : "Unable to load org members."
        );
        setIsLoading(false);
        return;
      }

      const { data: pair } = await supabase
        .from("mentorship_pairs")
        .select("*")
        .eq("organization_id", orgId)
        .eq("mentor_user_id", user.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (pair) {
        setPairId(pair.id);
        setCurrentMenteeId(pair.mentee_user_id);
        setInitialMenteeId(pair.mentee_user_id);
        setStatus(normalizeMentorshipStatus(pair.status));
      }

      setIsLoading(false);
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [orgId, user]);

  const handleAssign = async () => {
    if (!mentorId || !currentMenteeId) {
      setError("Select a mentee to assign.");
      return;
    }

    const shouldNotify = !pairId || currentMenteeId !== initialMenteeId;

    setIsSaving(true);
    setError(null);

    const payload = {
      organization_id: orgId,
      mentor_user_id: mentorId,
      mentee_user_id: currentMenteeId,
      status,
    };

    const { data, error: upsertError } = pairId
      ? await supabase
          .from("mentorship_pairs")
          .update(payload)
          .eq("id", pairId)
          .eq("mentor_user_id", mentorId)
          .is("deleted_at", null)
          .select("id")
          .maybeSingle()
      : await supabase.from("mentorship_pairs").insert(payload).select("id").maybeSingle();

    if (upsertError) {
      setError(upsertError.message);
      setIsSaving(false);
      return;
    }

    if (shouldNotify && mentorId && currentMenteeId) {
      const menteeLabel =
        availableMentees.find((m) => m.value === currentMenteeId)?.label || "Mentee";
      try {
        const response = await fetchWithAuth("/api/notifications/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            title: "New Mentorship Pairing",
            body: `You've been paired for mentorship.\n\nMentor: ${mentorLabel}\nMentee: ${menteeLabel}`,
            channel: "both",
            audience: "both",
            targetUserIds: [mentorId, currentMenteeId],
          }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          console.warn("Failed to send mentorship pairing notification:", payload?.error || response.status);
        }
      } catch (notifError) {
        console.warn("Failed to send mentorship pairing notification:", notifError);
      }
    }

    setPairId(data?.id ?? pairId);
    setIsSaving(false);
    onRefresh();
  };

  const handleRemove = () => {
    if (!pairId || !mentorId) return;

    Alert.alert(
      "Remove mentee?",
      "This will remove your mentorship pairing. You can reassign later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setIsSaving(true);
            setError(null);

            const { error: deleteError } = await supabase
              .from("mentorship_pairs")
              .update({ deleted_at: new Date().toISOString() })
              .eq("id", pairId)
              .eq("mentor_user_id", mentorId)
              .is("deleted_at", null);

            if (deleteError) {
              setError(deleteError.message);
              setIsSaving(false);
              return;
            }

            setPairId(null);
            setCurrentMenteeId(null);
            setInitialMenteeId(null);
            setIsSaving(false);
            onRefresh();
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <View style={styles.card}>
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={MENTORSHIP_COLORS.primary} />
          <Text style={styles.inlineLoadingText}>Loading your mentorship controls...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Manage your mentee</Text>
        <Text style={styles.sectionSubtitle}>
          Assign or remove your mentee. Changes apply only to your own pairing.
        </Text>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <SelectField
        label="Mentee (active member)"
        value={availableMentees.find((m) => m.value === currentMenteeId)?.label || ""}
        placeholder="Select mentee"
        onPress={() => setActiveSelect("mentee")}
        styles={styles}
              />
      <SelectField
        label="Status"
        value={STATUS_OPTIONS.find((opt) => opt.value === status)?.label || ""}
        placeholder="Select status"
        onPress={() => setActiveSelect("status")}
        styles={styles}
              />
      <View style={styles.buttonRow}>
        {pairId ? (
          <Pressable
            onPress={handleRemove}
            disabled={isSaving}
            style={({ pressed }) => [
              styles.ghostButton,
              pressed && styles.ghostButtonPressed,
              isSaving && styles.buttonDisabled,
            ]}
          >
            <Text style={styles.ghostButtonText}>Remove mentee</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={handleAssign}
          disabled={isSaving}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            isSaving && styles.buttonDisabled,
          ]}
        >
          {isSaving ? (
            <ActivityIndicator color={MENTORSHIP_COLORS.primaryForeground} />
          ) : (
            <Text style={styles.primaryButtonText}>{pairId ? "Update mentee" : "Assign mentee"}</Text>
          )}
        </Pressable>
      </View>

      <SelectModal
        visible={activeSelect === "mentee"}
        title="Select mentee"
        options={availableMentees}
        selectedValue={currentMenteeId}
        onSelect={(option) => {
          setCurrentMenteeId(option.value);
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
        styles={styles}
              />
      <SelectModal
        visible={activeSelect === "status"}
        title="Select status"
        options={STATUS_OPTIONS}
        selectedValue={status}
        onSelect={(option) => {
          setStatus(option.value as MentorshipStatus);
          setActiveSelect(null);
        }}
        onClose={() => setActiveSelect(null)}
        styles={styles}
              />
    </View>
  );
}

function MentorshipPairsList({
  pairs,
  logsByPair,
  userLabel,
  isAdmin,
  canLogActivity,
  orgId,
  userId,
  styles,
  onRefresh,
  onArchive,
}: {
  pairs: MentorshipPair[];
  logsByPair: Record<string, MentorshipLog[]>;
  userLabel: (id: string) => string;
  isAdmin: boolean;
  canLogActivity: boolean;
  orgId: string;
  userId: string | null;
  styles: ReturnType<typeof createStyles>;
  onRefresh: () => void;
  onArchive: (pairId: string) => void;
}) {
  if (pairs.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.emptyTitle}>No mentorship pairs yet</Text>
        <Text style={styles.emptySubtitle}>Pairs will appear here once created.</Text>
      </View>
    );
  }

  return (
    <View style={styles.pairsList}>
      {pairs.map((pair) => (
        <MentorshipPairCard
          key={pair.id}
          pair={pair}
          mentorLabel={userLabel(pair.mentor_user_id)}
          menteeLabel={userLabel(pair.mentee_user_id)}
          logs={logsByPair[pair.id] || []}
          isAdmin={isAdmin}
          canLogActivity={canLogActivity}
          orgId={orgId}
          userId={userId}
          userLabel={userLabel}
          styles={styles}
          onRefresh={onRefresh}
          onArchive={onArchive}
        />
      ))}
    </View>
  );
}

function MentorshipPairCard({
  pair,
  mentorLabel,
  menteeLabel,
  logs,
  isAdmin,
  canLogActivity,
  orgId,
  userId,
  userLabel,
  styles,
  onRefresh,
  onArchive,
}: {
  pair: MentorshipPair;
  mentorLabel: string;
  menteeLabel: string;
  logs: MentorshipLog[];
  isAdmin: boolean;
  canLogActivity: boolean;
  orgId: string;
  userId: string | null;
  userLabel: (id: string) => string;
  styles: ReturnType<typeof createStyles>;
  onRefresh: () => void;
  onArchive: (pairId: string) => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    Alert.alert(
      "Archive mentorship pair?",
      "This will hide the pair from active views while preserving the activity history.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          style: "destructive",
          onPress: async () => {
            setIsDeleting(true);
            setError(null);

            const { error: logsError } = await supabase
              .from("mentorship_logs")
              .update({ deleted_at: new Date().toISOString() })
              .eq("pair_id", pair.id)
              .is("deleted_at", null);

            if (logsError) {
              setError("Unable to delete mentorship logs. Please try again.");
              setIsDeleting(false);
              return;
            }

            const { error: pairError } = await supabase
              .from("mentorship_pairs")
              .update({ deleted_at: new Date().toISOString() })
              .eq("id", pair.id)
              .is("deleted_at", null);

            if (pairError) {
              setError("Unable to delete mentorship pair. Please try again.");
              setIsDeleting(false);
              return;
            }

            setIsDeleting(false);
            onArchive(pair.id);
            onRefresh();
          },
        },
      ]
    );
  };

  const isMine = isUserInMentorshipPair(pair, userId ?? undefined);
  const statusColor =
    normalizeMentorshipStatus(pair.status) === "completed"
      ? MENTORSHIP_COLORS.secondaryText
      : normalizeMentorshipStatus(pair.status) === "paused"
        ? MENTORSHIP_COLORS.warning
        : MENTORSHIP_COLORS.success;

  return (
    <View style={[styles.card, isMine && styles.highlightedCard]}>
      <View style={styles.pairHeader}>
        <View style={styles.pairColumn}>
          <Text style={styles.pairName}>{mentorLabel}</Text>
          <Text style={styles.pairRole}>Mentor</Text>
        </View>
        <View style={styles.pairCenter}>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}22` }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {normalizeMentorshipStatus(pair.status)}
            </Text>
          </View>
          {isAdmin ? (
            <Pressable
              onPress={handleDelete}
              disabled={isDeleting}
              style={({ pressed }) => [
                styles.deleteButton,
                pressed && styles.deleteButtonPressed,
                isDeleting && styles.buttonDisabled,
              ]}
            >
              <Trash2 size={14} color={MENTORSHIP_COLORS.error} />
              <Text style={styles.deleteButtonText}>Archive</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.pairColumnRight}>
          <Text style={styles.pairName}>{menteeLabel}</Text>
          <Text style={styles.pairRole}>Mentee</Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {logs.length > 0 ? (
        <View style={styles.logList}>
          {logs.slice(0, 5).map((log) => (
            <View key={log.id} style={styles.logItem}>
              <View style={styles.logMeta}>
                <Text style={styles.logMetaText}>
                  {formatDefaultDateFromString(log.entry_date)}
                </Text>
                <Text style={styles.logMetaText}>Logged by {userLabel(log.created_by)}</Text>
              </View>
              {log.notes ? <Text style={styles.logNotes}>{log.notes}</Text> : null}
              {log.progress_metric !== null ? (
                <Text style={styles.logMetric}>
                  Progress metric: {log.progress_metric}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptySubtitle}>No activity logged yet.</Text>
      )}

      {canLogActivity && userId ? (
        <View style={styles.logFormContainer}>
          <MentorshipLogForm
            orgId={orgId}
            pairId={pair.id}
            userId={userId}
            styles={styles}
                        onSaved={onRefresh}
          />
        </View>
      ) : null}
    </View>
  );
}

function MentorshipLogForm({
  orgId,
  pairId,
  userId,
  styles,
  onSaved,
}: {
  orgId: string;
  pairId: string;
  userId: string;
  styles: ReturnType<typeof createStyles>;
  onSaved: () => void;
}) {
  const [entryDate, setEntryDate] = useState<Date>(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [notes, setNotes] = useState("");
  const [progressMetric, setProgressMetric] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!userId) {
      setError("You must be signed in to log progress.");
      return;
    }

    setIsSaving(true);
    setError(null);

    const metricValue = progressMetric.trim()
      ? Number.parseInt(progressMetric, 10)
      : null;
    const sanitizedMetric = Number.isNaN(metricValue) ? null : metricValue;

    const { error: insertError } = await supabase.from("mentorship_logs").insert({
      organization_id: orgId,
      pair_id: pairId,
      created_by: userId,
      entry_date: entryDate.toISOString().slice(0, 10),
      notes: notes.trim() || null,
      progress_metric: sanitizedMetric,
    });

    if (insertError) {
      setError(insertError.message);
      setIsSaving(false);
      return;
    }

    setNotes("");
    setProgressMetric("");
    setIsSaving(false);
    onSaved();
  };

  const handleDateChange = (_event: unknown, selectedDate?: Date) => {
    if (selectedDate) {
      setEntryDate(selectedDate);
    }
    if (Platform.OS !== "ios") {
      setShowPicker(false);
    }
  };

  return (
    <View style={styles.logForm}>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Date</Text>
        <Pressable
          onPress={() => setShowPicker(true)}
          style={({ pressed }) => [
            styles.selectField,
            pressed && styles.selectFieldPressed,
          ]}
        >
          <Text style={styles.selectFieldText}>
            {formatDefaultDate(entryDate)}
          </Text>
          <ChevronDown size={16} color={MENTORSHIP_COLORS.mutedForeground} />
        </Pressable>
        {showPicker ? (
          <View style={styles.pickerContainer}>
            <DateTimePicker
              value={entryDate}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={handleDateChange}
            />
            {Platform.OS === "ios" ? (
              <Pressable
                onPress={() => setShowPicker(false)}
                style={({ pressed }) => [
                  styles.ghostButton,
                  pressed && styles.ghostButtonPressed,
                ]}
              >
                <Text style={styles.ghostButtonText}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="What did you work on?"
          placeholderTextColor={MENTORSHIP_COLORS.secondaryText}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.textArea]}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Progress metric (optional)</Text>
        <TextInput
          value={progressMetric}
          onChangeText={setProgressMetric}
          placeholder="e.g., 3 sessions"
          placeholderTextColor={MENTORSHIP_COLORS.secondaryText}
          keyboardType="number-pad"
          style={styles.input}
        />
      </View>
      <Pressable
        onPress={handleSave}
        disabled={isSaving}
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.primaryButtonPressed,
          isSaving && styles.buttonDisabled,
        ]}
      >
        {isSaving ? (
          <ActivityIndicator color={MENTORSHIP_COLORS.primaryForeground} />
        ) : (
          <Text style={styles.primaryButtonText}>Save log</Text>
        )}
      </Pressable>
    </View>
  );
}

function SelectField({
  label,
  value,
  placeholder,
  onPress,
  styles,
}: {
  label: string;
  value: string;
  placeholder: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.selectField,
          pressed && styles.selectFieldPressed,
        ]}
      >
        <Text
          style={[
            styles.selectFieldText,
            !value && { color: MENTORSHIP_COLORS.secondaryText },
          ]}
        >
          {value || placeholder}
        </Text>
        <ChevronDown size={16} color={MENTORSHIP_COLORS.mutedForeground} />
      </Pressable>
    </View>
  );
}

function SelectModal({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
  styles,
}: {
  visible: boolean;
  title: string;
  options: SelectOption[];
  selectedValue: string | null;
  onSelect: (option: SelectOption) => void;
  onClose: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.modalCloseText}>Close</Text>
            </Pressable>
          </View>
          {options.length === 0 ? (
            <Text style={styles.modalEmptyText}>No options available.</Text>
          ) : (
            <FlatList
              data={options}
              keyExtractor={(item) => item.value}
              ItemSeparatorComponent={() => <View style={styles.modalDivider} />}
              renderItem={({ item }) => {
                const isSelected = item.value === selectedValue;
                return (
                  <Pressable
                    onPress={() => onSelect(item)}
                    style={({ pressed }) => [
                      styles.modalOption,
                      pressed && styles.modalOptionPressed,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        isSelected && { color: MENTORSHIP_COLORS.primary },
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              removeClippedSubviews={true}
            />
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

const createStyles = (surfaceColor: string) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: MENTORSHIP_COLORS.background,
    },
    // Gradient header styles
    headerGradient: {
      paddingBottom: spacing.md,
    },
    headerSafeArea: {
      // SafeAreaView handles top inset
    },
    headerContent: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      minHeight: 40,
      gap: spacing.sm,
    },
    orgLogoButton: {
      width: 36,
      height: 36,
    },
    orgLogo: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    orgAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: APP_CHROME.avatarBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    orgAvatarText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: APP_CHROME.avatarText,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: APP_CHROME.headerTitle,
    },
    headerMeta: {
      fontSize: fontSize.xs,
      color: APP_CHROME.headerMeta,
      marginTop: 2,
    },
    contentSheet: {
      flex: 1,
      backgroundColor: surfaceColor,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },
    header: {
      gap: spacing.xs,
    },
    title: {
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    subtitle: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    card: {
      backgroundColor: MENTORSHIP_COLORS.card,
      borderRadius: borderRadius.lg,
      borderCurve: "continuous",
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      padding: spacing.md,
      gap: spacing.md,
      boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
    },
    sectionHeader: {
      gap: spacing.xs,
    },
    sectionTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    sectionSubtitle: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    stateContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
    },
    stateText: {
      fontSize: fontSize.base,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    errorCard: {
      backgroundColor: `${MENTORSHIP_COLORS.error}14`,
      borderRadius: borderRadius.md,
      padding: spacing.md,
      gap: spacing.sm,
      borderWidth: 1,
      borderColor: `${MENTORSHIP_COLORS.error}55`,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.error,
    },
    retryButton: {
      alignSelf: "flex-start",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: borderRadius.md,
      backgroundColor: MENTORSHIP_COLORS.error,
    },
    retryButtonPressed: {
      opacity: 0.85,
    },
    retryButtonText: {
      color: "#ffffff",
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
    },
    inlineLoading: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    inlineLoadingText: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    toggleLabel: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.primaryText,
    },
    fieldGroup: {
      gap: spacing.xs,
    },
    helperText: {
      fontSize: fontSize.xs,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    fieldLabel: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    selectField: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      backgroundColor: MENTORSHIP_COLORS.background,
    },
    selectFieldPressed: {
      opacity: 0.9,
    },
    selectFieldText: {
      fontSize: fontSize.base,
      color: MENTORSHIP_COLORS.primaryText,
    },
    input: {
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: fontSize.base,
      color: MENTORSHIP_COLORS.primaryText,
      backgroundColor: MENTORSHIP_COLORS.background,
    },
    textArea: {
      minHeight: 90,
    },
    primaryButton: {
      backgroundColor: MENTORSHIP_COLORS.primary,
      borderRadius: borderRadius.md,
      paddingVertical: spacing.sm,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonPressed: {
      opacity: 0.9,
    },
    primaryButtonText: {
      color: MENTORSHIP_COLORS.primaryForeground,
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
    },
    ghostButton: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      backgroundColor: MENTORSHIP_COLORS.card,
    },
    ghostButtonPressed: {
      opacity: 0.85,
    },
    ghostButtonText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.medium,
      color: MENTORSHIP_COLORS.primaryText,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: spacing.sm,
      flexWrap: "wrap",
    },
    inlineLinkButton: {
      alignSelf: "flex-start",
      paddingVertical: spacing.xs,
    },
    inlineLinkButtonPressed: {
      opacity: 0.8,
    },
    inlineLinkText: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.primary,
      fontWeight: fontWeight.medium,
    },
    directoryFilterRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    directoryFilterField: {
      flex: 1,
    },
    directoryCallout: {
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: MENTORSHIP_COLORS.border,
      backgroundColor: MENTORSHIP_COLORS.mutedSurface,
      padding: spacing.md,
      gap: spacing.md,
    },
    directoryCalloutBody: {
      gap: spacing.xs,
    },
    calloutTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    calloutSubtitle: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    calloutButton: {
      alignSelf: "flex-start",
      paddingHorizontal: spacing.md,
    },
    profileFormCard: {
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      backgroundColor: MENTORSHIP_COLORS.mutedSurface,
      padding: spacing.md,
      gap: spacing.md,
    },
    directoryEmptyState: {
      alignItems: "flex-start",
      gap: spacing.xs,
      paddingTop: spacing.xs,
    },
    directoryList: {
      gap: spacing.md,
    },
    directoryCard: {
      borderRadius: borderRadius.lg,
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      backgroundColor: MENTORSHIP_COLORS.card,
      padding: spacing.md,
      gap: spacing.sm,
    },
    directoryCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    directoryAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
    },
    directoryAvatarFallback: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: MENTORSHIP_COLORS.mutedSurface,
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
    },
    directoryAvatarFallbackText: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    directoryHeaderText: {
      flex: 1,
      gap: 2,
    },
    directoryName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    directoryMeta: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    directoryBadgeRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.xs,
    },
    directoryBadge: {
      borderRadius: 999,
      backgroundColor: MENTORSHIP_COLORS.mutedSurface,
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    directoryBadgeText: {
      fontSize: fontSize.xs,
      color: MENTORSHIP_COLORS.primaryText,
      fontWeight: fontWeight.medium,
    },
    directoryBio: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.primaryText,
      lineHeight: 20,
    },
    directoryExpertise: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
      lineHeight: 20,
    },
    directoryContactRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    contactButton: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      borderRadius: borderRadius.md,
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      backgroundColor: MENTORSHIP_COLORS.background,
    },
    contactButtonPressed: {
      opacity: 0.85,
    },
    contactButtonText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: MENTORSHIP_COLORS.primaryText,
    },
    pairsList: {
      gap: spacing.md,
    },
    highlightedCard: {
      borderColor: MENTORSHIP_COLORS.primaryLight,
      borderWidth: 2,
    },
    pairHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    pairColumn: {
      flex: 1,
    },
    pairColumnRight: {
      flex: 1,
      alignItems: "flex-end",
    },
    pairCenter: {
      alignItems: "center",
      gap: spacing.xs,
    },
    pairName: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    pairRole: {
      fontSize: fontSize.xs,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    statusBadge: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 999,
    },
    statusBadgeText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      textTransform: "capitalize",
    },
    deleteButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
      backgroundColor: `${MENTORSHIP_COLORS.error}14`,
    },
    deleteButtonPressed: {
      opacity: 0.85,
    },
    deleteButtonText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.error,
    },
    logList: {
      gap: spacing.sm,
    },
    logItem: {
      backgroundColor: MENTORSHIP_COLORS.mutedSurface,
      borderRadius: borderRadius.md,
      padding: spacing.sm,
      gap: spacing.xs,
    },
    logMeta: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    logMetaText: {
      fontSize: fontSize.xs,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    logNotes: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.primaryText,
    },
    logMetric: {
      fontSize: fontSize.xs,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    emptyTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    emptySubtitle: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
    },
    logFormContainer: {
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: MENTORSHIP_COLORS.border,
    },
    logForm: {
      gap: spacing.sm,
    },
    pickerContainer: {
      borderWidth: 1,
      borderColor: MENTORSHIP_COLORS.border,
      borderRadius: borderRadius.md,
      overflow: "hidden",
      backgroundColor: MENTORSHIP_COLORS.card,
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: "rgba(0, 0, 0, 0.4)",
      padding: spacing.md,
    },
    modalSheet: {
      backgroundColor: MENTORSHIP_COLORS.card,
      borderRadius: borderRadius.lg,
      padding: spacing.md,
      maxHeight: "70%",
      gap: spacing.sm,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    modalTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: MENTORSHIP_COLORS.primaryText,
    },
    modalCloseText: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.primary,
      fontWeight: fontWeight.semibold,
    },
    modalOption: {
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.md,
    },
    modalOptionPressed: {
      backgroundColor: MENTORSHIP_COLORS.mutedSurface,
    },
    modalOptionText: {
      fontSize: fontSize.base,
      color: MENTORSHIP_COLORS.primaryText,
    },
    modalDivider: {
      height: 1,
      backgroundColor: MENTORSHIP_COLORS.border,
    },
    modalEmptyText: {
      fontSize: fontSize.sm,
      color: MENTORSHIP_COLORS.secondaryText,
      paddingVertical: spacing.sm,
      textAlign: "center",
    },
  });
