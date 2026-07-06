"use client";

import { getApiUrl } from "~/lib/env";
import { useCallback, useEffect, useState } from "react";
import type { UniversalUser } from "~/types/universal";

export type PokerClub = {
  id: string;
  name: string;
  inviteCode: string;
  role: string;
  memberCount: number;
  createdAt: string;
};

export type PokerClubMember = {
  fid: number;
  username: string;
  pfpUrl: string;
  role: string;
  joinedAt: string;
};

export type PokerClubTable = {
  id: string;
  name: string;
  status: string;
  game: string;
  stakes: string;
  maxPlayers: number;
  playerCount: number;
  createdAt: string;
};

export type PokerClubReport = {
  id: number;
  messageId: number;
  tableId: string;
  tableName: string;
  reporterFid: number;
  reporterName: string;
  reportedFid: number;
  reportedName: string;
  message: string;
  reason: string;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByFid: number | null;
  resolutionNote: string;
};

export type PokerClubDetail = PokerClub & {
  isAdmin: boolean;
  members: PokerClubMember[];
  tables: PokerClubTable[];
  reports: PokerClubReport[];
};

type ClubsResponse = {
  success: boolean;
  clubs: PokerClub[];
  clubDetail?: PokerClubDetail;
  error?: string;
};

type ClubMutationResponse = {
  success: boolean;
  club?: PokerClub;
  clubs?: PokerClub[];
  clubDetail?: PokerClubDetail;
  error?: string;
};

export function usePokerClubs(user: UniversalUser, activeClubId?: string | null) {
  const [clubs, setClubs] = useState<PokerClub[]>([]);
  const [clubDetail, setClubDetail] = useState<PokerClubDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [mutating, setMutating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyResponse = useCallback((data: ClubMutationResponse | ClubsResponse) => {
    if (data.clubs) {
      setClubs(data.clubs);
    }
    if ("clubDetail" in data) {
      setClubDetail(data.clubDetail ?? null);
    }
    setError(null);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!Number.isSafeInteger(user.fid)) {
      setClubs([]);
      setClubDetail(null);
      setError("A valid player identity is required to load clubs.");
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(getApiUrl(`/api/clubs?fid=${encodeURIComponent(String(user.fid))}`), {
        cache: "no-store",
        signal,
      });
      const data = (await response.json()) as ClubsResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load clubs.");
      }

      applyResponse(data);
    } catch (caughtError) {
      if (signal?.aborted) {
        return;
      }

      setError(caughtError instanceof Error ? caughtError.message : "Unable to load clubs.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [applyResponse, user.fid]);

  const refreshClubDetail = useCallback(async (clubId: string, signal?: AbortSignal) => {
    if (!Number.isSafeInteger(user.fid)) {
      setClubDetail(null);
      setDetailLoading(false);
      return;
    }

    setDetailLoading(true);
    try {
      const response = await fetch(
        getApiUrl(`/api/clubs?fid=${encodeURIComponent(String(user.fid))}&club_id=${encodeURIComponent(clubId)}`),
        {
          cache: "no-store",
          signal,
        },
      );
      const data = (await response.json()) as ClubsResponse;

      if (!response.ok || !data.success || !data.clubDetail) {
        throw new Error(data.error || "Unable to load club details.");
      }

      applyResponse(data);
    } catch (caughtError) {
      if (signal?.aborted) {
        return;
      }

      setClubDetail(null);
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load club details.");
    } finally {
      if (!signal?.aborted) {
        setDetailLoading(false);
      }
    }
  }, [applyResponse, user.fid]);

  useEffect(() => {
    const abortController = new AbortController();
    void refresh(abortController.signal);
    return () => abortController.abort();
  }, [refresh]);

  useEffect(() => {
    const abortController = new AbortController();

    if (!activeClubId) {
      setClubDetail(null);
      return () => abortController.abort();
    }

    void refreshClubDetail(activeClubId, abortController.signal);
    return () => abortController.abort();
  }, [activeClubId, refreshClubDetail]);

  const mutateClub = useCallback(async (
    action: string,
    body: Record<string, unknown>,
    mutationKey: string,
  ) => {
    setMutating(mutationKey);
    try {
      const response = await fetch(getApiUrl("/api/clubs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          fid: user.fid,
          username: user.username,
          pfp_url: user.avatarUrl ?? "",
          ...body,
        }),
      });
      const data = (await response.json()) as ClubMutationResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to update club.");
      }

      applyResponse(data);
      return data;
    } catch (caughtError) {
      const nextError =
        caughtError instanceof Error ? caughtError.message : "Unable to update club.";
      setError(nextError);
      throw new Error(nextError);
    } finally {
      setMutating(null);
    }
  }, [applyResponse, user.avatarUrl, user.fid, user.username]);

  const createClub = useCallback(async (name: string) => {
    const data = await mutateClub("create", { name }, "create_club");
    if (!data.club) {
      throw new Error("Unable to create club.");
    }
    return data.club;
  }, [mutateClub]);

  const joinClub = useCallback(async (inviteCode: string) => {
    const data = await mutateClub("join", { inviteCode }, "join_club");
    if (!data.club) {
      throw new Error("Unable to join club.");
    }
    return data.club;
  }, [mutateClub]);

  const regenerateInvite = useCallback(async (clubId: string) => {
    await mutateClub("regenerate_invite", { club_id: clubId }, `regenerate:${clubId}`);
  }, [mutateClub]);

  const removeMember = useCallback(async (clubId: string, targetFid: number) => {
    await mutateClub("remove_member", { club_id: clubId, target_fid: targetFid }, `remove:${targetFid}`);
  }, [mutateClub]);

  const reviewReport = useCallback(async (
    clubId: string,
    reportId: number,
    status: "resolved" | "dismissed",
  ) => {
    await mutateClub(
      status === "resolved" ? "resolve_report" : "dismiss_report",
      { club_id: clubId, report_id: reportId },
      `report:${reportId}:${status}`,
    );
  }, [mutateClub]);

  return {
    clubs,
    clubDetail,
    loading,
    detailLoading,
    mutating,
    error,
    refresh,
    refreshClubDetail,
    createClub,
    joinClub,
    regenerateInvite,
    removeMember,
    reviewReport,
  };
}
