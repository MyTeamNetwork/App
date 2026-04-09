import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  MENTORSHIP_MENTEE_ROLES,
  MENTORSHIP_MENTOR_ROLES,
  getMentorshipSectionOrder,
  getVisibleMentorshipPairs,
  isUserInMentorshipPair,
  memberDisplayLabel,
  partitionPairableOrgMembers,
  type PairableOrgMemberRow,
} from "@teammeet/core";
import type { MentorshipLog, MentorshipPair, User } from "@teammeet/types";
import type {
  MentorDirectoryEntry,
  MentorProfileRecord,
  SelectOption,
} from "@/types/mentorship";

const STALE_TIME_MS = 30_000;

export async function loadPairableOrgMembers(orgId: string) {
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

export interface UseMentorshipReturn {
  pairs: MentorshipPair[];
  logs: MentorshipLog[];
  users: User[];
  mentorDirectory: MentorDirectoryEntry[];
  mentorIndustries: string[];
  mentorYears: number[];
  currentUserMentorProfile: MentorProfileRecord | null;
  archivedPairIds: string[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  filteredPairs: MentorshipPair[];
  visibleFilteredPairs: MentorshipPair[];
  userMap: Record<string, string>;
  userLabel: (id: string) => string;
  logsByPair: Record<string, MentorshipLog[]>;
  myPair: MentorshipPair | null;
  myMentorName: string | null;
  myLastLogDate: string | null;
  sectionOrder: ReturnType<typeof getMentorshipSectionOrder>;
  showDirectory: boolean;
  refetch: () => void;
  refetchIfStale: () => void;
  archivePair: (pairId: string) => void;
}

export function useMentorship(
  orgId: string | null,
  userId: string | undefined,
  role: string | null,
  isAdmin: boolean
): UseMentorshipReturn {
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);

  const [pairs, setPairs] = useState<MentorshipPair[]>([]);
  const [logs, setLogs] = useState<MentorshipLog[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [mentorDirectory, setMentorDirectory] = useState<MentorDirectoryEntry[]>([]);
  const [mentorIndustries, setMentorIndustries] = useState<string[]>([]);
  const [mentorYears, setMentorYears] = useState<number[]>([]);
  const [currentUserMentorProfile, setCurrentUserMentorProfile] =
    useState<MentorProfileRecord | null>(null);
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
          userId
            ? supabase
                .from("mentor_profiles")
                .select("*")
                .eq("organization_id", orgId)
                .eq("user_id", userId)
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
        const mentorUserIds = (mentorProfilesData || []).map(
          (profile) => profile.user_id
        );

        const userIdSet = new Set<string>();
        (pairsData || []).forEach((pair) => {
          if (pair.mentor_user_id) userIdSet.add(pair.mentor_user_id);
          if (pair.mentee_user_id) userIdSet.add(pair.mentee_user_id);
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
          userIdSet.size
            ? supabase
                .from("users")
                .select("id, name, email")
                .in("id", Array.from(userIdSet))
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

        const mentorsForDirectory: MentorDirectoryEntry[] = (
          mentorProfilesData || []
        ).map((profile) => {
          const profileUser = Array.isArray(profile.users)
            ? profile.users[0]
            : profile.users;
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
        });

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
          setCurrentUserMentorProfile(
            (currentUserProfileData as MentorProfileRecord | null) ?? null
          );
          setArchivedPairIds((current) =>
            current.filter((pairId) =>
              (pairsData || []).some((pair) => pair.id === pairId)
            )
          );
          setError(null);
          lastFetchTimeRef.current = Date.now();
        }
      } catch (fetchError) {
        if (isMountedRef.current) {
          setError(
            (fetchError as Error).message || "Failed to load mentorship data."
          );
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [orgId, userId]
  );

  useEffect(() => {
    isMountedRef.current = true;
    loadMentorshipData();

    return () => {
      isMountedRef.current = false;
    };
  }, [loadMentorshipData]);

  const refetch = useCallback(
    () => loadMentorshipData(true),
    [loadMentorshipData]
  );

  const refetchIfStale = useCallback(() => {
    if (Date.now() - lastFetchTimeRef.current > STALE_TIME_MS) {
      loadMentorshipData();
    }
  }, [loadMentorshipData]);

  const archivePair = useCallback((pairId: string) => {
    setArchivedPairIds((current) =>
      current.includes(pairId) ? current : [...current, pairId]
    );
  }, []);

  const filteredPairs = useMemo(() => {
    if (isAdmin) return pairs;
    if (!userId) return [];
    if (role === "active_member") {
      return pairs.filter((pair) => pair.mentee_user_id === userId);
    }
    if (role === "alumni") {
      return pairs.filter((pair) => pair.mentor_user_id === userId);
    }
    return [];
  }, [pairs, isAdmin, role, userId]);

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

  const userLabel = useCallback(
    (id: string) => userMap[id] || "Unknown",
    [userMap]
  );

  const logsByPair = useMemo(() => {
    return logs.reduce(
      (acc, log) => {
        if (!acc[log.pair_id]) {
          acc[log.pair_id] = [];
        }
        acc[log.pair_id].push(log);
        return acc;
      },
      {} as Record<string, MentorshipLog[]>
    );
  }, [logs]);

  const myPair = useMemo(() => {
    if (role !== "active_member" || !userId) {
      return null;
    }
    return filteredPairs.find((pair) => pair.mentee_user_id === userId) ?? null;
  }, [filteredPairs, role, userId]);

  const myMentorName = myPair ? userLabel(myPair.mentor_user_id) : null;
  const myLastLogDate = myPair
    ? logsByPair[myPair.id]?.[0]?.entry_date ?? null
    : null;

  const sectionOrder = getMentorshipSectionOrder({
    hasPairs: visibleFilteredPairs.length > 0,
    isAdmin,
  });

  const showDirectory = Boolean(orgId);

  return {
    pairs,
    logs,
    users,
    mentorDirectory,
    mentorIndustries,
    mentorYears,
    currentUserMentorProfile,
    archivedPairIds,
    loading,
    refreshing,
    error,
    filteredPairs,
    visibleFilteredPairs,
    userMap,
    userLabel,
    logsByPair,
    myPair,
    myMentorName,
    myLastLogDate,
    sectionOrder,
    showDirectory,
    refetch,
    refetchIfStale,
    archivePair,
  };
}
