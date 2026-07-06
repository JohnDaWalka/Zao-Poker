"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getApiUrl } from "~/lib/env";
import {
  usePokerProductData,
  type AnalyticsData,
  type HandHistoryEntry,
  type LeaderboardEntry,
} from "~/hooks/usePokerProductData";
import {
  usePokerClubs,
  type PokerClub,
  type PokerClubDetail,
} from "~/hooks/usePokerClubs";
import { useTableChat } from "~/hooks/useTableChat";
import { ConnectWallet } from "~/components/ui/wallet/ConnectWallet";
import { useMiniAppReady } from "~/hooks/useMiniAppReady";
import {
  useRenderLobby,
  type GameType,
  type PokerTable,
  type TableStatus,
} from "~/hooks/useRenderLobby";
import { useUniversalUser } from "~/hooks/useUniversalUser";
import type { UniversalUser } from "~/types/universal";

type Tab = "lobby" | "table" | "analysis" | "leaderboard" | "profile";
type SolverPanelData = {
  success: boolean;
  analysis: string;
  confidence: number;
  gto: {
    street: string;
    potOdds: number;
    equity: number;
    winRate: number;
    tieRate: number;
    trials: number;
    exploitability: number;
    recommendedAction: string;
    opponentRangeProfile: string;
    strategy: Record<string, number>;
    counterfactualRegret: Record<string, number>;
    actionEvs: Record<string, number>;
    recommendations: Array<{
      action: string;
      frequency: string;
      description: string;
    }>;
    tags: string[];
    summary: string;
  };
};

function occupiedSeats(table: PokerTable) {
  return table.seats.filter((seat) => seat.user).length;
}

function getStatusLabel(status: PokerTable["status"]) {
  if (status === "in_game") return "In Game";
  if (status === "full") return "Full";
  if (status === "seated") return "Seated";
  return "Waiting";
}

function shortAddress(address?: string) {
  if (!address) return null;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCards(cards: string[]) {
  return cards.length > 0 ? cards.join(" ") : "—";
}

function getCardDisplay(card: string) {
  if (!card || card.length < 2) {
    return { rank: "", suitSymbol: "", isRed: false };
  }

  const rank = card[0] === "T" ? "10" : card[0];
  const suit = card[1];

  if (suit === "h") return { rank, suitSymbol: "♥", isRed: true };
  if (suit === "d") return { rank, suitSymbol: "♦", isRed: true };
  if (suit === "c") return { rank, suitSymbol: "♣", isRed: false };
  if (suit === "s") return { rank, suitSymbol: "♠", isRed: false };

  return { rank, suitSymbol: "", isRed: false };
}

function formatStartTime(startTime?: string | null) {
  if (!startTime) {
    return "Open seating";
  }

  const timestamp = new Date(startTime).getTime();
  if (Number.isNaN(timestamp)) {
    return "Open seating";
  }

  const deltaMs = timestamp - Date.now();
  if (deltaMs <= 0) {
    return "Starting now";
  }

  const minutes = Math.round(deltaMs / 60000);
  if (minutes < 60) {
    return `Starts in ${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `Starts in ${hours}h ${remainder}m`;
}

function formatChatTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "now";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function handInsight(hand: HandHistoryEntry) {
  if (hand.result === "win") {
    return hand.resolution === "showdown"
      ? "Showdown line held through the river."
      : "Fold equity closed the hand before showdown.";
  }

  if (hand.result === "split") {
    return "Pot was shared after both ranges converged.";
  }

  return hand.resolution === "fold"
    ? "Pressure line didn’t realize fold equity."
    : "Showdown equity fell short against villain’s range.";
}

function leaderboardTag(player: LeaderboardEntry) {
  if (player.netWinnings > 0 && player.bestStreak >= 4) {
    return "Heater";
  }
  if (player.handsPlayed >= 40) {
    return "Volume";
  }
  if (player.handsWon > 0 && player.handsWon / Math.max(player.handsPlayed, 1) > 0.5) {
    return "Closer";
  }
  return "Grinder";
}

function buildGraphPoints(analytics: AnalyticsData | null) {
  const values =
    analytics?.series?.length && analytics.series.some((point) => point.net !== 0)
      ? analytics.series.map((point) => point.net)
      : [0, 1, 0.5, 1.4, 0.8, 2, 1.6];

  const width = 320;
  const height = 120;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const normalized = (value - min) / range;
      const y = height - normalized * 90 - 15;
      return `${x},${y}`;
    })
    .join(" ");
}

function buildGraphAreaPath(analytics: AnalyticsData | null) {
  const points = buildGraphPoints(analytics);
  return `M${points.replace(/ /g, " L")} L320,120 L0,120 Z`;
}

function humanRuntimeLabel(runtimeHost: ReturnType<typeof useUniversalUser>["runtimeHost"]) {
  switch (runtimeHost) {
    case "farcaster":
      return "Farcaster";
    case "ios_safari":
      return "iPhone Safari";
    case "android_chrome":
      return "Android Chrome";
    case "desktop_browser":
      return "Desktop Browser";
    default:
      return "Browser";
  }
}

export default function ZaoPokerUI() {
  useMiniAppReady();

  const user = useUniversalUser();
  const [activeTab, setActiveTab] = useState<Tab>("lobby");
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [lobbySearch, setLobbySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TableStatus>("all");
  const [gameFilter, setGameFilter] = useState<"all" | GameType>("all");
  const lobby = useRenderLobby(user);

  // Keep last good active table to prevent UI from switching to another table or empty state on transient poll/refresh
  const lastGoodActiveTableRef = useRef<PokerTable | null>(null);
  const clubs = usePokerClubs(user, selectedClubId);
  const productData = usePokerProductData(user.fid, user.authSource);

  const tables = lobby.state.tables;
  const filteredTables = useMemo(() => {
    return tables.filter((table) => {
      const matchesSearch =
        lobbySearch.trim().length === 0 ||
        table.name.toLowerCase().includes(lobbySearch.trim().toLowerCase()) ||
        table.stakes.toLowerCase().includes(lobbySearch.trim().toLowerCase()) ||
        (table.clubName ?? "").toLowerCase().includes(lobbySearch.trim().toLowerCase());
      const matchesStatus = statusFilter === "all" || table.status === statusFilter;
      const matchesGame = gameFilter === "all" || table.game === gameFilter;
      return matchesSearch && matchesStatus && matchesGame;
    });
  }, [gameFilter, lobbySearch, statusFilter, tables]);

  const activeTable = useMemo(() => {
    const found = tables.find((table) => table.id === activeTableId);
    if (found) return found;
    return lastGoodActiveTableRef.current || null;
  }, [activeTableId, tables]);

  const seatedTable = useMemo(() => {
    return tables.find((table) =>
      table.seats.some((seat) => seat.user?.fid === user.fid)
    );
  }, [tables, user.fid]);

  const selectedClub = useMemo(
    () => {
      if (clubs.clubDetail && clubs.clubDetail.id === selectedClubId) {
        return clubs.clubDetail;
      }
      return clubs.clubs.find((club) => club.id === selectedClubId) ?? null;
    },
    [clubs.clubDetail, clubs.clubs, selectedClubId],
  );

  useEffect(() => {
    if (!activeTableId && seatedTable) {
      setActiveTableId(seatedTable.id);
      return;
    }

    if (!activeTableId && tables[0]) {
      setActiveTableId(tables[0].id);
    }
  }, [activeTableId, seatedTable, tables]);

  useEffect(() => {
    const found = tables.find((t) => t.id === activeTableId);
    if (found && (found.board.length > 0 || found.seats.some((s) => s.user?.fid === user.fid && s.holeCards.length > 0))) {
      lastGoodActiveTableRef.current = found;
    }
  }, [activeTableId, tables, user.fid]);

  useEffect(() => {
    if (!selectedClubId && clubs.clubs[0]) {
      setSelectedClubId(clubs.clubs[0].id);
      return;
    }

    if (selectedClubId && !clubs.clubs.some((club) => club.id === selectedClubId)) {
      setSelectedClubId(clubs.clubs[0]?.id ?? null);
    }
  }, [clubs.clubs, selectedClubId]);

  function createTable() {
    void lobby.createTable({
      name: selectedClub ? `${selectedClub.name} Home Game` : "Neon Felt Table",
      game: "NLHE",
      stakes: "$0.10 / $0.25",
      maxPlayers: 6,
      buyIn: 25,
      visibility: selectedClub ? "club" : "public",
      clubId: selectedClub?.id ?? null,
    }, user);
  }

  async function createClub(name: string) {
    const club = await clubs.createClub(name);
    setSelectedClubId(club.id);
    await lobby.refresh();
  }

  async function joinClub(inviteCode: string) {
    const club = await clubs.joinClub(inviteCode);
    setSelectedClubId(club.id);
    await lobby.refresh();
  }

  async function regenerateClubInvite() {
    if (!selectedClubId) {
      return;
    }

    await clubs.regenerateInvite(selectedClubId);
  }

  async function removeClubMember(targetFid: number) {
    if (!selectedClubId) {
      return;
    }

    await clubs.removeMember(selectedClubId, targetFid);
    await lobby.refresh();
  }

  async function reviewClubReport(reportId: number, status: "resolved" | "dismissed") {
    if (!selectedClubId) {
      return;
    }

    await clubs.reviewReport(selectedClubId, reportId, status);
  }

  async function joinTable(table: PokerTable) {
    const joined = await lobby.joinTable(table.id, user);
    if (!joined) {
      return;
    }
    // Force the table view to stick even if polling hasn't updated yet
    setActiveTableId(table.id);
    setActiveTab("table");
    // Trigger a refresh so state (including hole cards) comes in immediately
    setTimeout(() => {
      void lobby.refresh();
    }, 50);
  }

  function leaveTable(table: PokerTable) {
    void lobby.leaveTable(table.id, user);
  }

  function toggleReady(table: PokerTable) {
    void lobby.toggleReady(table.id, user);
  }

  async function playTableAction(
    table: PokerTable,
    action: "fold" | "check" | "call" | "bet" | "raise" | "all_in",
    amount?: number,
  ) {
    await lobby.takeTableAction(table.id, user, action, amount ?? 0);
  }

  async function dealNextHand(table: PokerTable) {
    await lobby.dealTableHand(table.id, user);
  }

  return (
    <main className="ls-shell">
      <div className="ls-bg-molecule ls-bg-molecule-a">HO—N—CH₃</div>
      <div className="ls-bg-molecule ls-bg-molecule-b">C₂₁H₃₀O₂ · EDGE</div>
      <div className="ls-bg-film">ILFORD HP5 PLUS · 400TX</div>

      {activeTab !== "table" && (
        <section className="ls-hero">
          <div className="ls-brand-block">
            <div className="ls-logo">
              <span>♠</span>
            </div>

            <div>
              <p className="ls-eyebrow">Cross-chain poker intelligence</p>
              <h1>ZAO</h1>
              <p className="ls-hero-copy">
                A universal poker mini-app for Farcaster, iOS Safari, Android,
                desktop browsers, and wallet-enabled web.
              </p>
            </div>
          </div>

          <UniversalIdentityCard user={user} />
        </section>
      )}

      {activeTab !== "table" && (
        <section className="ls-status-row">
          <div
            className={
              lobby.status === "connected"
                ? "ls-connection online"
                : "ls-connection offline"
            }
          >
            <span />
            {lobby.status === "connected"
              ? lobby.mode === "render"
                ? "Render lobby live"
                : "Vercel lobby live"
              : "Reconnecting lobby"}
          </div>

          <div className="ls-runtime-pill">
            {user.authSource.toUpperCase()} · {humanRuntimeLabel(user.runtimeHost)}
            {user.walletAddress ? ` · ${shortAddress(user.walletAddress)}` : ""}
          </div>

          {!lobby.supportsReadyState && (
            <div className="ls-runtime-pill">
              Current mode: compatible fallback
            </div>
          )}

          {lobby.error && <div className="ls-error">{lobby.error}</div>}
          {productData.error && <div className="ls-error">{productData.error}</div>}
        </section>
      )}

      <section className="ls-main-grid">
        <aside className="ls-sidebar">
          <div className="ls-panel ls-profile-panel">
            <div className="ls-avatar-xl">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatarUrl} alt={user.displayName} />
              ) : (
                user.displayName.slice(0, 1)
              )}
            </div>

            <h2>{user.displayName}</h2>
            <p>{user.username}</p>

            <div className="ls-wallet-box">
              <small>Wallet</small>
              <strong>{shortAddress(user.walletAddress) ?? "Not connected"}</strong>
            </div>

            {user.authSource !== "farcaster" && (
              <div className="ls-connect-wrap">
                <ConnectWallet />
              </div>
            )}
          </div>

          <nav className="ls-nav">
            <NavButton
              active={activeTab === "lobby"}
              icon="◆"
              label="Lobby"
              onClick={() => setActiveTab("lobby")}
            />
            <NavButton
              active={activeTab === "table"}
              icon="♠"
              label="Table"
              onClick={() => setActiveTab("table")}
            />
            <NavButton
              active={activeTab === "analysis"}
              icon="◎"
              label="Analysis"
              onClick={() => setActiveTab("analysis")}
            />
            <NavButton
              active={activeTab === "leaderboard"}
              icon="▥"
              label="Leaderboard"
              onClick={() => setActiveTab("leaderboard")}
            />
            <NavButton
              active={activeTab === "profile"}
              icon="✦"
              label="Profile"
              onClick={() => setActiveTab("profile")}
            />
          </nav>
        </aside>

        <section className="ls-content">
          {activeTab === "lobby" && (
            <LobbyView
              tables={filteredTables}
              activeTableId={activeTable?.id ?? null}
              seatedTableId={seatedTable?.id ?? null}
              canCreate={lobby.supportsTableCreation}
              clubs={clubs.clubs}
              clubDetail={clubs.clubDetail}
              selectedClubId={selectedClubId}
              clubLoading={clubs.loading}
              clubDetailLoading={clubs.detailLoading}
              clubMutating={clubs.mutating}
              clubError={clubs.error}
              searchValue={lobbySearch}
              statusFilter={statusFilter}
              gameFilter={gameFilter}
              totalTables={tables.length}
              viewerFid={user.fid}
              onSearchChange={setLobbySearch}
              onStatusFilterChange={setStatusFilter}
              onGameFilterChange={setGameFilter}
              onSelectClub={setSelectedClubId}
              onCreateClub={createClub}
              onJoinClub={joinClub}
              onRegenerateInvite={regenerateClubInvite}
              onRemoveMember={removeClubMember}
              onReviewReport={reviewClubReport}
              onCreate={createTable}
              onSelect={(table) => {
                setActiveTableId(table.id);
                setActiveTab("table");
              }}
              onJoin={joinTable}
            />
          )}

          {activeTab === "table" && activeTable && (
            <ActionTableView
              table={activeTable}
              user={user}
              onJoin={() => joinTable(activeTable)}
              onLeave={() => leaveTable(activeTable)}
              onReady={() => toggleReady(activeTable)}
              onGameAction={(action, amount) => {
                const lobbyWithActions = lobby as typeof lobby & {
                  sendGameAction?: (
                    tableId: string,
                    user: UniversalUser,
                    payload: { action: string; amount?: number },
                  ) => void;
                };
                lobbyWithActions.sendGameAction?.(activeTable.id, user, {
                  action,
                  amount,
                });
                // Also call local for compatibility
                playTableAction(activeTable, action as any, amount);
              }}
              onDealNextHand={() => dealNextHand(activeTable)}
            />
          )}

          {activeTab === "analysis" && (
            <AnalysisView
              loading={productData.loading}
              dashboard={productData.dashboard}
              analytics={productData.analytics}
              hands={productData.hands}
              table={activeTable}
              userFid={user.fid}
            />
          )}

          {activeTab === "leaderboard" && (
            <LeaderboardView
              leaderboard={productData.leaderboard}
              viewerRank={productData.viewerRank}
              currentFid={user.fid}
              bestFriends={productData.bestFriends}
            />
          )}

          {activeTab === "profile" && (
            <ProfileView
              user={user}
              tableCount={tables.length}
              seatedTable={seatedTable}
              dashboard={productData.dashboard}
              analytics={productData.analytics}
              bestFriendCount={productData.bestFriends.length}
            />
          )}
        </section>
      </section>

      <MobileBottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </main>
  );
}

function UniversalIdentityCard({
  user,
}: {
  user: ReturnType<typeof useUniversalUser>;
}) {
  return (
    <div className="ls-identity-card">
      <div className="ls-identity-avatar">
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt={user.displayName} />
        ) : (
          user.displayName.slice(0, 1)
        )}
      </div>

      <div>
        <strong>{user.displayName}</strong>
        <small>
          {user.authSource === "farcaster" ? `FID ${user.fid}` : user.authSource}
          {user.chainNamespace ? ` · ${user.chainNamespace}` : ""}
        </small>
      </div>
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "ls-nav-button active" : "ls-nav-button"}
      onClick={onClick}
      type="button"
    >
      <span>{icon}</span>
      <strong>{label}</strong>
    </button>
  );
}

function LobbyView({
  tables,
  activeTableId,
  seatedTableId,
  canCreate,
  clubs,
  clubDetail,
  selectedClubId,
  clubLoading,
  clubDetailLoading,
  clubMutating,
  clubError,
  searchValue,
  statusFilter,
  gameFilter,
  totalTables,
  viewerFid,
  onSearchChange,
  onStatusFilterChange,
  onGameFilterChange,
  onSelectClub,
  onCreateClub,
  onJoinClub,
  onRegenerateInvite,
  onRemoveMember,
  onReviewReport,
  onCreate,
  onSelect,
  onJoin,
}: {
  tables: PokerTable[];
  activeTableId: string | null;
  seatedTableId: string | null;
  canCreate: boolean;
  clubs: PokerClub[];
  clubDetail: PokerClubDetail | null;
  selectedClubId: string | null;
  clubLoading: boolean;
  clubDetailLoading: boolean;
  clubMutating: string | null;
  clubError: string | null;
  searchValue: string;
  statusFilter: "all" | TableStatus;
  gameFilter: "all" | GameType;
  totalTables: number;
  viewerFid: number;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: "all" | TableStatus) => void;
  onGameFilterChange: (value: "all" | GameType) => void;
  onSelectClub: (clubId: string | null) => void;
  onCreateClub: (name: string) => Promise<void>;
  onJoinClub: (inviteCode: string) => Promise<void>;
  onRegenerateInvite: () => Promise<void>;
  onRemoveMember: (fid: number) => Promise<void>;
  onReviewReport: (reportId: number, status: "resolved" | "dismissed") => Promise<void>;
  onCreate: () => void;
  onSelect: (table: PokerTable) => void;
  onJoin: (table: PokerTable) => void;
}) {
  const [clubNameDraft, setClubNameDraft] = useState("");
  const [inviteCodeDraft, setInviteCodeDraft] = useState("");
  const [clubActionError, setClubActionError] = useState<string | null>(null);
  const [clubActionLoading, setClubActionLoading] = useState<"create" | "join" | null>(null);

  async function submitCreateClub() {
    const trimmed = clubNameDraft.trim();
    if (!trimmed) {
      return;
    }

    try {
      setClubActionLoading("create");
      setClubActionError(null);
      await onCreateClub(trimmed);
      setClubNameDraft("");
    } catch (caughtError) {
      setClubActionError(
        caughtError instanceof Error ? caughtError.message : "Unable to create club.",
      );
    } finally {
      setClubActionLoading(null);
    }
  }

  async function submitJoinClub() {
    const trimmed = inviteCodeDraft.trim();
    if (!trimmed) {
      return;
    }

    try {
      setClubActionLoading("join");
      setClubActionError(null);
      await onJoinClub(trimmed);
      setInviteCodeDraft("");
    } catch (caughtError) {
      setClubActionError(
        caughtError instanceof Error ? caughtError.message : "Unable to join club.",
      );
    } finally {
      setClubActionLoading(null);
    }
  }

  async function regenerateInvite() {
    try {
      setClubActionError(null);
      await onRegenerateInvite();
    } catch (caughtError) {
      setClubActionError(
        caughtError instanceof Error ? caughtError.message : "Unable to rotate invite code.",
      );
    }
  }

  async function removeMember(fid: number) {
    try {
      setClubActionError(null);
      await onRemoveMember(fid);
    } catch (caughtError) {
      setClubActionError(
        caughtError instanceof Error ? caughtError.message : "Unable to remove club member.",
      );
    }
  }

  async function reviewReport(reportId: number, status: "resolved" | "dismissed") {
    try {
      setClubActionError(null);
      await onReviewReport(reportId, status);
    } catch (caughtError) {
      setClubActionError(
        caughtError instanceof Error ? caughtError.message : "Unable to review report.",
      );
    }
  }

  return (
    <div className="ls-view">
      <div className="ls-view-header" style={{ paddingBottom: '8px' }}>
        <div>
          <h2 style={{ fontSize: '18px', margin: '0 0 4px' }}>Tables</h2>
        </div>

        <button
          className="ls-primary-button ls-button-press"
          disabled={!canCreate}
          onClick={onCreate}
          type="button"
        >
          {selectedClubId ? "+ Host Club Game" : "+ Create Table"}
        </button>
      </div>

      <section className="ls-club-grid">
        <article className="ls-panel ls-club-panel">
          <div className="ls-club-panel-header">
            <div>
              <p className="ls-eyebrow">Home Games</p>
              <h3>Private clubs</h3>
            </div>
            <small>{clubs.length} joined</small>
          </div>

          {clubLoading && clubs.length === 0 && (
            <div className="ls-empty-card">
              <strong>Loading clubs…</strong>
              <p>Checking for private home-game groups tied to your identity.</p>
            </div>
          )}

          {!clubLoading && clubs.length === 0 && (
            <div className="ls-empty-card">
              <strong>No clubs yet.</strong>
              <p>Create a club or join one with an invite code to unlock private tables.</p>
            </div>
          )}

          <div className="ls-club-list">
            {clubs.map((club) => (
              <button
                key={club.id}
                className={selectedClubId === club.id ? "ls-club-card active" : "ls-club-card"}
                onClick={() => onSelectClub(selectedClubId === club.id ? null : club.id)}
                type="button"
              >
                <div className="ls-club-card-topline">
                  <strong>{club.name}</strong>
                  <span>{club.role}</span>
                </div>
                <small>Invite {club.inviteCode}</small>
                <small>{club.memberCount} members</small>
              </button>
            ))}
          </div>
        </article>

        <article className="ls-panel ls-club-panel">
          <div className="ls-club-panel-header">
            <div>
              <p className="ls-eyebrow">Club Tools</p>
              <h3>Create or join</h3>
            </div>
          </div>

          <div className="ls-club-form-stack">
            <label className="ls-filter-field">
              <span>Create club</span>
              <input
                className="ls-filter-input"
                maxLength={48}
                onChange={(event) => setClubNameDraft(event.target.value)}
                placeholder="Weekend Crushers"
                type="text"
                value={clubNameDraft}
              />
            </label>
            <button
              className="ls-secondary-button ls-button-press"
              disabled={clubActionLoading !== null || clubNameDraft.trim().length < 3}
              onClick={() => void submitCreateClub()}
              type="button"
            >
              {clubActionLoading === "create" ? "Creating…" : "Create Club"}
            </button>
          </div>

          <div className="ls-club-form-stack">
            <label className="ls-filter-field">
              <span>Join with invite code</span>
              <input
                className="ls-filter-input"
                maxLength={8}
                onChange={(event) => setInviteCodeDraft(event.target.value.toUpperCase())}
                placeholder="AB12CD34"
                type="text"
                value={inviteCodeDraft}
              />
            </label>
            <button
              className="ls-primary-button ls-button-press"
              disabled={clubActionLoading !== null || inviteCodeDraft.trim().length < 4}
              onClick={() => void submitJoinClub()}
              type="button"
            >
              {clubActionLoading === "join" ? "Joining…" : "Join Club"}
            </button>
          </div>

          {(clubActionError || clubError) && (
            <div className="ls-error">{clubActionError ?? clubError}</div>
          )}
        </article>
      </section>

      {selectedClubId && (
        <section className="ls-club-admin-grid">
          <article className="ls-panel ls-club-panel">
            <div className="ls-club-panel-header">
              <div>
                <p className="ls-eyebrow">Selected Club</p>
                <h3>{clubDetail?.name ?? "Loading club…"}</h3>
              </div>
              <small>{clubDetail?.role ?? "member"}</small>
            </div>

            {clubDetailLoading && !clubDetail && (
              <div className="ls-empty-card">
                <strong>Loading club HQ…</strong>
                <p>Pulling the latest roster, invite code, and club table overview.</p>
              </div>
            )}

            {!clubDetailLoading && clubDetail && (
              <>
                <div className="ls-club-stat-grid">
                  <div className="ls-info-tile">
                    <small>Invite Code</small>
                    <strong>{clubDetail.inviteCode}</strong>
                  </div>
                  <div className="ls-info-tile">
                    <small>Members</small>
                    <strong>{clubDetail.memberCount}</strong>
                  </div>
                  <div className="ls-info-tile">
                    <small>Live Tables</small>
                    <strong>{clubDetail.tables.length}</strong>
                  </div>
                </div>

                <div className="ls-club-inline-actions">
                  {clubDetail.isAdmin ? (
                    <button
                      className="ls-secondary-button ls-button-press"
                      disabled={clubMutating === `regenerate:${clubDetail.id}`}
                      onClick={() => void regenerateInvite()}
                      type="button"
                    >
                      {clubMutating === `regenerate:${clubDetail.id}`
                        ? "Rotating Invite…"
                        : "Regenerate Invite"}
                    </button>
                  ) : (
                    <div className="ls-runtime-pill">
                      Invite rotation and report review stay with club owners/admins.
                    </div>
                  )}
                </div>

                <div className="ls-club-subsection">
                  <div className="ls-club-subsection-header">
                    <strong>Club tables</strong>
                    <small>Private games tied to this club</small>
                  </div>
                  {clubDetail.tables.length === 0 ? (
                    <div className="ls-empty-card">
                      <strong>No private tables yet.</strong>
                      <p>Use the host button above to spin up the first home game for this club.</p>
                    </div>
                  ) : (
                    <div className="ls-club-mini-list">
                      {clubDetail.tables.map((table) => (
                        <div key={table.id} className="ls-club-mini-card">
                          <div className="ls-club-mini-topline">
                            <strong>{table.name}</strong>
                            <span>{table.status}</span>
                          </div>
                          <small>
                            {table.game} · {table.stakes}
                          </small>
                          <small>
                            {table.playerCount}/{table.maxPlayers} seated
                          </small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </article>

          <article className="ls-panel ls-club-panel">
            <div className="ls-club-panel-header">
              <div>
                <p className="ls-eyebrow">Roster</p>
                <h3>Members</h3>
              </div>
              <small>{clubDetail?.memberCount ?? 0} total</small>
            </div>

            {clubDetailLoading && !clubDetail && (
              <div className="ls-empty-card">
                <strong>Loading roster…</strong>
                <p>Syncing club seats and member roles.</p>
              </div>
            )}

            {!clubDetailLoading && clubDetail && (
              <div className="ls-club-mini-list">
                {clubDetail.members.map((member) => (
                  <div key={member.fid} className="ls-club-mini-card">
                    <div className="ls-club-mini-topline">
                      <strong>{member.username}</strong>
                      <span>{member.role}</span>
                    </div>
                    <small>fid {member.fid}</small>
                    {clubDetail.isAdmin && member.role !== "owner" && member.fid !== viewerFid && (
                      <button
                        className="ls-danger-button ls-button-press"
                        disabled={clubMutating === `remove:${member.fid}`}
                        onClick={() => void removeMember(member.fid)}
                        type="button"
                      >
                        {clubMutating === `remove:${member.fid}` ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="ls-panel ls-club-panel">
            <div className="ls-club-panel-header">
              <div>
                <p className="ls-eyebrow">Support Queue</p>
                <h3>Reports</h3>
              </div>
              <small>{clubDetail?.isAdmin ? "Admin view" : "Read only"}</small>
            </div>

            {clubDetailLoading && !clubDetail && (
              <div className="ls-empty-card">
                <strong>Loading reports…</strong>
                <p>Checking recent chat flags across this club’s tables.</p>
              </div>
            )}

            {!clubDetailLoading && clubDetail && !clubDetail.isAdmin && (
              <div className="ls-empty-card">
                <strong>Reports are owner-managed.</strong>
                <p>Members can flag chat, but only owners/admins can review or close reports.</p>
              </div>
            )}

            {!clubDetailLoading && clubDetail?.isAdmin && clubDetail.reports.length === 0 && (
              <div className="ls-empty-card">
                <strong>No open moderation load.</strong>
                <p>Recent club chat reports will show up here for quick review.</p>
              </div>
            )}

            {!clubDetailLoading && clubDetail?.isAdmin && clubDetail.reports.length > 0 && (
              <div className="ls-club-mini-list">
                {clubDetail.reports.map((report) => (
                  <div key={report.id} className="ls-club-mini-card">
                    <div className="ls-club-mini-topline">
                      <strong>{report.reportedName}</strong>
                      <span>{report.status}</span>
                    </div>
                    <small>
                      {report.tableName} · flagged by {report.reporterName}
                    </small>
                    <p className="ls-club-report-copy">
                      {report.message || "Original message unavailable."}
                    </p>
                    <small>Reason: {report.reason}</small>
                    {report.status === "open" ? (
                      <div className="ls-club-inline-actions">
                        <button
                          className="ls-secondary-button ls-button-press"
                          disabled={clubMutating === `report:${report.id}:dismissed`}
                          onClick={() => void reviewReport(report.id, "dismissed")}
                          type="button"
                        >
                          {clubMutating === `report:${report.id}:dismissed` ? "Dismissing…" : "Dismiss"}
                        </button>
                        <button
                          className="ls-primary-button ls-button-press"
                          disabled={clubMutating === `report:${report.id}:resolved`}
                          onClick={() => void reviewReport(report.id, "resolved")}
                          type="button"
                        >
                          {clubMutating === `report:${report.id}:resolved` ? "Resolving…" : "Resolve"}
                        </button>
                      </div>
                    ) : (
                      <small>
                        Reviewed {report.reviewedAt ? formatChatTime(report.reviewedAt) : "recently"}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>
      )}

      <section className="ls-lobby-controls">
        <label className="ls-filter-field">
          <span>Search</span>
          <input
            className="ls-filter-input"
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Table name or stakes"
            type="text"
            value={searchValue}
          />
        </label>

        <label className="ls-filter-field">
          <span>Status</span>
          <select
            className="ls-filter-input"
            onChange={(event) =>
              onStatusFilterChange(event.target.value as "all" | TableStatus)
            }
            value={statusFilter}
          >
            <option value="all">All statuses</option>
            <option value="waiting">Waiting</option>
            <option value="seated">Seated</option>
            <option value="in_game">In Game</option>
            <option value="full">Full</option>
          </select>
        </label>

        <label className="ls-filter-field">
          <span>Game</span>
          <select
            className="ls-filter-input"
            onChange={(event) =>
              onGameFilterChange(event.target.value as "all" | GameType)
            }
            value={gameFilter}
          >
            <option value="all">All games</option>
            <option value="NLHE">NLHE</option>
            <option value="PLO">PLO</option>
            <option value="PLO8">PLO8</option>
            <option value="STUD8">STUD8</option>
          </select>
        </label>

        <div className="ls-filter-summary">
          <strong>{tables.length}</strong>
          <small>{tables.length === totalTables ? "Live tables" : `of ${totalTables} live tables`}</small>
        </div>
      </section>

      <div className="ls-lobby-grid">
        {tables.length === 0 && (
          <div className="ls-empty-card">
            <strong>No tables match these filters.</strong>
            <p>Try widening the status or game filters to see more live action.</p>
          </div>
        )}

        {tables.map((table) => {
          const occupied = occupiedSeats(table);
          const isActive = table.id === activeTableId;
          const isSeatedHere = table.id === seatedTableId;
          const isFull = occupied >= table.maxPlayers;

          return (
            <article
              key={table.id}
              className={isActive ? "ls-table-card active" : "ls-table-card"}
              onClick={() => onSelect(table)}
            >
              <div className="ls-table-topline">
                <span className={`ls-status-badge ${table.status}`}>
                  {getStatusLabel(table.status)}
                </span>

                <span className="ls-game-chip">{table.game}</span>
              </div>

              <h3>{table.name}</h3>

              <div className="ls-table-meta">
                <span>{table.stakes}</span>
                <span>{formatCurrency(table.buyIn)} buy-in</span>
                <span>
                  {occupied}/{table.maxPlayers} seated
                </span>
                {table.visibility === "club" && (
                  <span>{table.clubName ?? "Club"} private table</span>
                )}
                <span>{formatStartTime(table.startTime)}</span>
              </div>

              <SeatDots table={table} />

              <div className="ls-card-actions">
                <button
                  className="ls-secondary-button ls-button-press"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(table);
                  }}
                  type="button"
                >
                  View
                </button>

                <button
                  className="ls-primary-button ls-button-press"
                  disabled={Boolean(seatedTableId) || isFull || table.status === "in_game"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onJoin(table);
                  }}
                  type="button"
                >
                  {isSeatedHere
                    ? "Seated"
                    : isFull
                      ? "Full"
                      : table.status === "in_game"
                        ? "In Game"
                        : "Join"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function SeatDots({ table }: { table: PokerTable }) {
  return (
    <div className="ls-seat-dots">
      {table.seats.map((seat) => (
        <span
          key={seat.seatNumber}
          className={seat.user ? "filled" : ""}
          title={seat.user?.displayName ?? `Seat ${seat.seatNumber}`}
        />
      ))}
    </div>
  );
}

// --- New Action-first table UI (replaces old TableView) ---

type CardSuit = "♠" | "♥" | "♦" | "♣";
type CardColor = "black" | "red";

type PlayingCard = {
  rank: string;
  suit: CardSuit;
};

type GameStreet = "preflop" | "flop" | "turn" | "river" | "showdown";

type GameActionType =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all_in";

type ActionLogItem = {
  id: string;
  seatNumber: number;
  playerName: string;
  action: GameActionType;
  amount?: number;
  street: GameStreet;
  timestamp: number;
};

type HandState = {
  handId: string;
  street: GameStreet;
  pot: number;
  toCall: number;
  minBet: number;
  minRaise: number;
  heroHoleCards: PlayingCard[];
  boardCards: PlayingCard[];
  dealerSeatNumber: number;
  smallBlindSeatNumber: number;
  bigBlindSeatNumber: number;
  currentTurnSeatNumber: number | null;
  legalActions: GameActionType[];
  actionLog: ActionLogItem[];
};

type TableWithHandState = PokerTable & {
  handState?: HandState;
};

function getCardColor(card: PlayingCard): CardColor {
  return card.suit === "♥" || card.suit === "♦" ? "red" : "black";
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function getFallbackHandState(table: PokerTable, user: UniversalUser): HandState {
  const heroSeat =
    table.seats.find((seat) => seat.user?.fid === user.fid) ?? table.seats[0];

  return {
    handId: "preview-hand",
    street: "flop",
    pot: 84.5,
    toCall: 12.5,
    minBet: 18,
    minRaise: 36,
    heroHoleCards: [
      { rank: "A", suit: "♠" },
      { rank: "T", suit: "♠" },
    ],
    boardCards: [
      { rank: "Q", suit: "♠" },
      { rank: "8", suit: "♠" },
      { rank: "3", suit: "♦" },
    ],
    dealerSeatNumber: 1,
    smallBlindSeatNumber: 2,
    bigBlindSeatNumber: 3,
    currentTurnSeatNumber: heroSeat?.seatNumber ?? null,
    legalActions: ["fold", "call", "raise", "all_in"],
    actionLog: [
      {
        id: "a1",
        seatNumber: 2,
        playerName: "CryptoAce",
        action: "bet",
        amount: 12.5,
        street: "flop",
        timestamp: Date.now() - 16000,
      },
      {
        id: "a2",
        seatNumber: heroSeat?.seatNumber ?? 1,
        playerName: heroSeat?.user?.displayName ?? "You",
        action: "call",
        amount: 12.5,
        street: "flop",
        timestamp: Date.now() - 9000,
      },
    ],
  };
}

function getHandState(table: PokerTable, user: UniversalUser): HandState {
  const maybeTable = table as TableWithHandState;
  if (maybeTable.handState) return maybeTable.handState;

  const heroSeat = table.seats.find((seat) => seat.user?.fid === user.fid);
  const bb = table.currentBlinds?.bb || 10;
  const toCall = heroSeat ? Math.max(0, table.currentBet - heroSeat.currentBet) : 0;
  
  const parseCard = (cardStr: string): PlayingCard => {
    const rank = cardStr.slice(0, 1);
    const suitChar = cardStr.slice(1, 2);
    const suitMap: Record<string, CardSuit> = {
      h: "♥",
      d: "♦",
      c: "♣",
      s: "♠",
    };
    return {
      rank: rank.toUpperCase(),
      suit: suitMap[suitChar] || "♠",
    };
  };

  const boardCards = (table.board || []).map(parseCard);
  const heroHoleCards = heroSeat?.holeCards ? heroSeat.holeCards.map(parseCard) : [];

  const activeSeats = table.seats.filter(s => s.user);
  const dealerSeatIndex =
    typeof table.dealerSeatIndex === "number" ? table.dealerSeatIndex : 0;

  // Compute blind positions relative to the persisted dealer button.
  const getRelativeSeat = (offset: number) =>
    activeSeats[(dealerSeatIndex + offset) % activeSeats.length];

  let dealerSeatNumber = activeSeats[dealerSeatIndex]?.seatNumber ?? 1;
  let smallBlindSeatNumber = activeSeats.length > 0
    ? getRelativeSeat(1)?.seatNumber ?? 1
    : 1;
  let bigBlindSeatNumber = activeSeats.length > 0
    ? getRelativeSeat(2)?.seatNumber ?? 2
    : 2;

  if (activeSeats.length === 2) {
    // Heads-up: dealer is the small blind.
    smallBlindSeatNumber = dealerSeatNumber;
    bigBlindSeatNumber = getRelativeSeat(1)?.seatNumber ?? bigBlindSeatNumber;
  }

  const currentTurnSeat = table.seats.find(s => s.user?.fid === table.currentTurnFid);
  const currentTurnSeatNumber = currentTurnSeat ? currentTurnSeat.seatNumber : null;

  let legalActions: GameActionType[] = [];
  const isHeroTurn = heroSeat && table.currentTurnFid === heroSeat.user?.fid;
  if (isHeroTurn) {
    const heroStack = heroSeat.stack || 0;
    if (toCall === 0) {
      legalActions = ["check", "bet", "all_in", "fold"];
    } else {
      legalActions = ["fold", "call"];
      if (heroStack > toCall) {
        legalActions.push("raise", "all_in");
      } else {
        legalActions.push("all_in");
      }
    }
  }

  const actionLog: ActionLogItem[] = [];
  if (table.actionHistory) {
    table.actionHistory.forEach((rawEntry, idx) => {
      const parts = rawEntry.split(":");
      if (parts.length >= 2) {
        const actorRaw = parts[0];
        const actionRaw = parts[1] as GameActionType;
        const amountRaw = parts[2] ? parseInt(parts[2]) : undefined;
        
        let actorFid = 1;
        if (actorRaw.startsWith("p")) {
          actorFid = parseInt(actorRaw.slice(1)) || 1;
        } else if (actorRaw === "ai") {
          actorFid = 1;
        }
        
        const seat = table.seats.find(s => s.user?.fid === actorFid);
        if (seat) {
          actionLog.push({
            id: `act-${idx}`,
            seatNumber: seat.seatNumber,
            playerName: seat.user?.displayName || seat.user?.username || `Player ${actorFid}`,
            action: actionRaw,
            amount: amountRaw,
            street: table.phase as GameStreet,
            timestamp: Date.now(),
          });
        }
      }
    });
  }

  return {
    handId: table.id,
    street: (table.phase || "preflop") as GameStreet,
    pot: table.potSize,
    toCall,
    minBet: bb,
    minRaise: table.currentBet + Math.max(bb, toCall),
    heroHoleCards,
    boardCards,
    dealerSeatNumber,
    smallBlindSeatNumber,
    bigBlindSeatNumber,
    currentTurnSeatNumber,
    legalActions,
    actionLog,
  };
}

function getActionLabel(action: GameActionType, amount?: number) {
  switch (action) {
    case "fold":
      return "Fold";
    case "check":
      return "Check";
    case "call":
      return amount ? `Call ${formatMoney(amount)}` : "Call";
    case "bet":
      return amount ? `Bet ${formatMoney(amount)}` : "Bet";
    case "raise":
      return amount ? `Raise ${formatMoney(amount)}` : "Raise";
    case "all_in":
      return "All In";
    default:
      return action;
  }
}

function ActionTableView({
  table,
  user,
  onJoin,
  onLeave,
  onReady,
  onGameAction,
  onDealNextHand,
}: {
  table: PokerTable;
  user: UniversalUser;
  onJoin: () => void;
  onLeave: () => void;
  onReady: () => void;
  onGameAction: (action: string, amount?: number) => void;
  onDealNextHand: () => void;
}) {
  const hand = getHandState(table, user);

  const [betAmount, setBetAmount] = useState<number>(
    Math.max(hand.minRaise, hand.minBet),
  );

  const currentSeat = table.seats.find((seat) => seat.user?.fid === user.fid);
  const occupied = occupiedSeats(table);
  const readyCount = table.seats.filter((seat) => seat.user && seat.isReady).length;
  const isFull = occupied >= table.maxPlayers;

  const isHeroTurn =
    Boolean(currentSeat) &&
    hand.currentTurnSeatNumber === currentSeat?.seatNumber;

  const heroIsSeated = Boolean(currentSeat);
  const tableIsActive = table.status === "in_game";
  const canAct = heroIsSeated && tableIsActive && isHeroTurn;

  const visiblePlayers = table.seats.filter((seat) => seat.user);

  function submitAction(action: string) {
    if (!canAct) return;

    const amount =
      action === "bet" || action === "raise"
        ? betAmount
        : action === "call"
          ? hand.toCall
          : undefined;

    onGameAction(action, amount);
  }

  return (
    <div className="ls-view ls-play-view">
      <div className="ls-play-topbar" style={{ padding: '8px 12px', fontSize: '11px' }}>
        <div className="ls-play-top-actions">
          {!currentSeat && (
            <button
              className="ls-primary-button ls-button-press"
              onClick={onJoin}
              disabled={isFull || table.status === "in_game"}
            >
              {isFull ? "Full" : "Take Seat"}
            </button>
          )}

          {currentSeat && table.status !== "in_game" && (
            <>
              <button className="ls-secondary-button" onClick={onReady}>
                {currentSeat.isReady ? "Unready" : "Ready"}
              </button>

              <button className="ls-danger-button" onClick={onLeave}>
                Leave
              </button>
            </>
          )}

          {hand.street === "showdown" && currentSeat && (
            <button className="ls-primary-button" onClick={onDealNextHand}>
              Deal Next Hand
            </button>
          )}
        </div>
      </div>

      <section className="ls-play-layout">
        <div className="ls-play-main">
          <div className="ls-board-stage">
            {hand.street === "showdown" && (
              <ShowdownBanner heroHasCards={hand.heroHoleCards.length > 0} pot={hand.pot} />
            )}
            <div className="ls-pot-orb">
              <small>Pot</small>
              <strong>{formatMoney(hand.pot)}</strong>
              <span>{hand.street.toUpperCase()}</span>
            </div>

            <BoardCards cards={hand.boardCards} />

            <HeroHoleCards cards={hand.heroHoleCards} isHeroTurn={isHeroTurn} />

            <div className="ls-table-orbit">
              {table.seats.map((seat) => (
                <PlayerSeatMini
                  key={seat.seatNumber}
                  seat={seat}
                  isDealer={seat.seatNumber === hand.dealerSeatNumber}
                  isSmallBlind={seat.seatNumber === hand.smallBlindSeatNumber}
                  isBigBlind={seat.seatNumber === hand.bigBlindSeatNumber}
                  isTurn={seat.seatNumber === hand.currentTurnSeatNumber}
                  isHero={seat.user?.fid === user.fid}
                />
              ))}
            </div>
          </div>

          <ActionControls
            canAct={canAct}
            legalActions={hand.legalActions}
            toCall={hand.toCall}
            minBet={hand.minBet}
            minRaise={hand.minRaise}
            betAmount={betAmount}
            setBetAmount={setBetAmount}
            onAction={submitAction}
            potSize={hand.pot}
            heroStack={currentSeat?.stack ?? 0}
          />
        </div>

        <aside className="ls-play-rail">
          <section className="ls-play-panel">
            <div className="ls-player-list">
              {visiblePlayers.map((seat) => (
                <PlayerRow
                  key={seat.seatNumber}
                  seat={seat}
                  isTurn={seat.seatNumber === hand.currentTurnSeatNumber}
                  isHero={seat.user?.fid === user.fid}
                />
              ))}
            </div>
          </section>

          <section className="ls-play-panel">
            <ActionLog items={hand.actionLog} />
          </section>

          <section className="ls-play-panel">
            <div className="ls-hand-info-grid">
              <InfoTile label="To Call" value={formatMoney(hand.toCall)} />
              <InfoTile label="Min Bet" value={formatMoney(hand.minBet)} />
              <InfoTile label="Min Raise" value={formatMoney(hand.minRaise)} />
              <InfoTile label="Street" value={hand.street} />
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function BoardCards({ cards }: { cards: PlayingCard[] }) {
  const emptySlots = Math.max(0, 5 - cards.length);

  return (
    <div className="ls-board-cards">
      {cards.map((card, index) => (
        <CardFace key={`${card.rank}-${card.suit}-${index}`} card={card} size="board" index={index} />
      ))}

      {Array.from({ length: emptySlots }).map((_, index) => (
        <div key={`empty-board-${index}`} className="ls-card-empty">
          <span />
        </div>
      ))}
    </div>
  );
}

function HeroHoleCards({
  cards,
  isHeroTurn,
}: {
  cards: PlayingCard[];
  isHeroTurn: boolean;
}) {
  return (
    <div className={isHeroTurn ? "ls-hero-hand active" : "ls-hero-hand"}>
      <div className="ls-hole-card-row">
        {cards.map((card, index) => (
          <CardFace key={`${card.rank}-${card.suit}-${index}`} card={card} size="hole" index={index} />
        ))}
      </div>
    </div>
  );
}

function ShowdownBanner({
  heroHasCards,
  pot,
}: {
  heroHasCards: boolean;
  pot: number;
}) {
  if (heroHasCards) {
    return (
      <div className="ls-win-banner">
        <strong>You Win!</strong>
        <small>Pot: {formatMoney(pot)}</small>
      </div>
    );
  }
  return (
    <div className="ls-lose-banner">
      <strong>You Folded</strong>
      <small>Better luck next hand</small>
    </div>
  );
}

function CardFace({
  card,
  size,
  index = 0,
}: {
  card: PlayingCard;
  size: "board" | "hole";
  index?: number;
}) {
  const delayClass = index > 0 && index <= 5 ? `ls-deal-delay-${index}` : "";
  return (
    <div className={`ls-card-face ${size} ${getCardColor(card)} ls-card-deal ${delayClass}`}>
      <b>{card.rank}</b>
      <span>{card.suit}</span>
    </div>
  );
}

function ActionControls({
  canAct,
  legalActions,
  toCall,
  minBet,
  minRaise,
  betAmount,
  setBetAmount,
  onAction,
  potSize,
  heroStack,
}: {
  canAct: boolean;
  legalActions: GameActionType[];
  toCall: number;
  minBet: number;
  minRaise: number;
  betAmount: number;
  setBetAmount: (value: number) => void;
  onAction: (action: string) => void;
  potSize: number;
  heroStack: number;
}) {
  const canFold = legalActions.includes("fold");
  const canCheck = legalActions.includes("check");
  const canCall = legalActions.includes("call");
  const canBet = legalActions.includes("bet");
  const canRaise = legalActions.includes("raise");
  const canAllIn = legalActions.includes("all_in");

  const minAggressiveAmount = canRaise ? minRaise : minBet;

  return (
    <section className={canAct ? "ls-action-dock active" : "ls-action-dock"}>
      <div className="ls-action-status">
        <div>
          <small>Decision</small>
          <strong>{canAct ? "Action is on you" : "Waiting for action"}</strong>
        </div>

        <div>
          <small>To Call</small>
          <strong>{formatMoney(toCall)}</strong>
        </div>
      </div>

      <div className="ls-bet-slider">
        <div className="ls-bet-slider-top">
          <span>Bet / Raise Amount</span>
          <strong>{formatMoney(betAmount)}</strong>
        </div>

        <input
          type="range"
          min={minAggressiveAmount}
          max={Math.max(minAggressiveAmount, heroStack)}
          step={1}
          value={betAmount}
          disabled={!canAct || (!canBet && !canRaise)}
          onChange={(event) => setBetAmount(Number(event.target.value))}
        />

        <div className="ls-bet-presets">
          {[0.33, 0.5, 0.75, 1].map((fraction) => {
            const value = Math.max(minAggressiveAmount, Math.round(potSize * fraction));

            return (
              <button
                key={fraction}
                disabled={!canAct || (!canBet && !canRaise)}
                onClick={() => setBetAmount(value)}
              >
                {fraction === 1 ? "Pot" : `${Math.round(fraction * 100)}%`}
              </button>
            );
          })}
        </div>
      </div>

      <div className="ls-action-buttons">
        <button
          className="ls-action-fold"
          disabled={!canAct || !canFold}
          onClick={() => onAction("fold")}
        >
          Fold
        </button>

        {canCheck ? (
          <button
            className="ls-action-neutral"
            disabled={!canAct}
            onClick={() => onAction("check")}
          >
            Check
          </button>
        ) : (
          <button
            className="ls-action-neutral"
            disabled={!canAct || !canCall}
            onClick={() => onAction("call")}
          >
            Call {formatMoney(toCall)}
          </button>
        )}

        {canBet && (
          <button
            className="ls-action-primary"
            disabled={!canAct}
            onClick={() => onAction("bet")}
          >
            Bet {formatMoney(betAmount)}
          </button>
        )}

        {canRaise && (
          <button
            className="ls-action-primary"
            disabled={!canAct}
            onClick={() => onAction("raise")}
          >
            Raise {formatMoney(betAmount)}
          </button>
        )}

        <button
          className="ls-action-allin"
          disabled={!canAct || !canAllIn}
          onClick={() => onAction("all_in")}
        >
          All In
        </button>
      </div>
    </section>
  );
}

function PlayerSeatMini({
  seat,
  isDealer,
  isSmallBlind,
  isBigBlind,
  isTurn,
  isHero,
}: {
  seat: PokerTable["seats"][number];
  isDealer: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isTurn: boolean;
  isHero: boolean;
}) {
  return (
    <div
      className={[
        "ls-orbit-seat",
        `seat-${seat.seatNumber}`,
        seat.user ? "filled" : "",
        isTurn ? "turn" : "",
        isHero ? "hero" : "",
      ].join(" ")}
    >
      <div className="ls-orbit-avatar">
        {seat.user?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={seat.user.avatarUrl} alt={seat.user.displayName} />
        ) : seat.user ? (
          seat.user.displayName.slice(0, 1)
        ) : (
          seat.seatNumber
        )}
      </div>

      <strong>{seat.user?.displayName ?? "Open"}</strong>

      <small>
        {isDealer ? "D" : isSmallBlind ? "SB" : isBigBlind ? "BB" : ""}
        {seat.user ? ` · ${formatMoney(seat.stack)}` : ""}
      </small>
    </div>
  );
}

function PlayerRow({
  seat,
  isTurn,
  isHero,
}: {
  seat: PokerTable["seats"][number];
  isTurn: boolean;
  isHero: boolean;
}) {
  if (!seat.user) return null;

  return (
    <div className={isTurn ? "ls-player-row turn" : "ls-player-row"}>
      <div className="ls-rank-avatar">
        {seat.user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={seat.user.avatarUrl} alt={seat.user.displayName} />
        ) : (
          seat.user.displayName.slice(0, 1)
        )}
      </div>

      <div>
        <strong>
          {seat.user.displayName}
          {isHero ? "  · You" : ""}
        </strong>
        <small>
          Seat {seat.seatNumber} · {seat.isReady ? "Ready" : "Not ready"}
        </small>
      </div>

      <b>{formatMoney(seat.stack)}</b>
    </div>
  );
}

function ActionLog({ items }: { items: ActionLogItem[] }) {
  if (items.length === 0) {
    return <p className="ls-empty-log">No actions yet.</p>;
  }

  return (
    <div className="ls-action-log">
      {[...items].reverse().map((item) => (
        <div key={item.id}>
          <span>Seat {item.seatNumber}</span>
          <strong>{item.playerName}</strong>
          <p>{getActionLabel(item.action, item.amount)}</p>
        </div>
      ))}
    </div>
  );
}

function AnalysisView({
  loading,
  dashboard,
  analytics,
  hands,
  table,
  userFid,
}: {
  loading: boolean;
  dashboard: ReturnType<typeof usePokerProductData>["dashboard"];
  analytics: ReturnType<typeof usePokerProductData>["analytics"];
  hands: ReturnType<typeof usePokerProductData>["hands"];
  table: PokerTable | null;
  userFid: number;
}) {
  const [solverData, setSolverData] = useState<SolverPanelData | null>(null);
  const [solverLoading, setSolverLoading] = useState(false);
  const [solverError, setSolverError] = useState<string | null>(null);

  const currentSeat = useMemo(
    () => table?.seats.find((seat) => seat.user?.fid === userFid) ?? null,
    [table, userFid],
  );
  const toCall = useMemo(() => {
    if (!table || !currentSeat) {
      return 0;
    }
    return Math.max(0, table.currentBet - currentSeat.currentBet);
  }, [currentSeat, table]);

  useEffect(() => {
    if (!table || !currentSeat || currentSeat.holeCards.length < 2) {
      setSolverData(null);
      setSolverLoading(false);
      setSolverError(null);
      return;
    }

    const abortController = new AbortController();
    setSolverLoading(true);
    setSolverError(null);

    async function loadSolverPanel() {
      // Re-narrow for the async closure (TS loses the effect-level guard here).
      if (!table || !currentSeat) {
        return;
      }
      try {
        const response = await fetch(getApiUrl("/api/analyze"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cards: currentSeat.holeCards,
            board: table.board,
            pot_size: table.potSize,
            to_call: toCall,
            stack_size: currentSeat.stack,
            action_history: table.actionHistory,
            action:
              table.currentTurnFid === currentSeat.user?.fid
                ? toCall > 0
                  ? "call"
                  : "check"
                : undefined,
          }),
          signal: abortController.signal,
        });

        const data = (await response.json()) as SolverPanelData & { error?: string };
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to analyze the current spot.");
        }

        setSolverData(data);
      } catch (caughtError) {
        if (abortController.signal.aborted) {
          return;
        }

        setSolverError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to analyze the current spot.",
        );
        setSolverData(null);
      } finally {
        if (!abortController.signal.aborted) {
          setSolverLoading(false);
        }
      }
    }

    void loadSolverPanel();
    return () => abortController.abort();
  }, [currentSeat, table, toCall]);

  const strategyRows = solverData
    ? Object.entries(solverData.gto.strategy).sort((left, right) => right[1] - left[1])
    : [];
  const regretRows = solverData
    ? Object.entries(solverData.gto.counterfactualRegret).sort((left, right) => right[1] - left[1])
    : [];
  const evRows = solverData
    ? Object.entries(solverData.gto.actionEvs).sort((left, right) => right[1] - left[1])
    : [];

  return (
    <div className="ls-view">
      <div className="ls-view-header">
        <div>
          <p className="ls-eyebrow">Hand Intelligence</p>
          <h2>Recent analysis</h2>
          <p>Review real hand history, win-rate trend, and session performance.</p>
        </div>
      </div>

      <section className="ls-analysis-hero">
        <div>
          <small>Session Net</small>
          <strong>{formatCurrency(dashboard?.netWinnings ?? 0)}</strong>
          <p>
            {analytics?.hands ?? dashboard?.handsPlayed ?? 0} hands ·{" "}
            {formatPercent(analytics?.winRate ?? dashboard?.winRate ?? 0)} win rate ·{" "}
            {(analytics?.netPer100Hands ?? 0).toFixed(1)} net / 100
          </p>
        </div>

        <MiniGraph analytics={analytics} />
      </section>

      <section className="ls-table-info-grid">
        <InfoTile label="Hands Played" value={String(dashboard?.handsPlayed ?? 0)} />
        <InfoTile label="Hands Won" value={String(dashboard?.handsWon ?? 0)} />
        <InfoTile label="Biggest Pot" value={formatCurrency(dashboard?.biggestPotWon ?? 0)} />
        <InfoTile label="Best Streak" value={String(dashboard?.bestStreak ?? 0)} />
      </section>

      <section className="ls-solver-panel">
        <div className="ls-view-header">
          <div>
            <p className="ls-eyebrow">Live Solver</p>
            <h2>Current spot guidance</h2>
            <p>Read the action mix, exploitability, and regret profile from the in-app solver.</p>
          </div>
        </div>

        {!table || !currentSeat || currentSeat.holeCards.length < 2 ? (
          <div className="ls-empty-card">
            <strong>No live hero hand available.</strong>
            <p>Join a table and get dealt cards to unlock the live solver panel for your current spot.</p>
          </div>
        ) : null}

        {solverLoading && (
          <div className="ls-empty-card">
            <strong>Running solver…</strong>
            <p>Crunching Monte Carlo equity and CFR rollout guidance for the current table state.</p>
          </div>
        )}

        {!solverLoading && solverError && <div className="ls-error">{solverError}</div>}

        {!solverLoading && solverData && (
          <>
            <section className="ls-analysis-hero">
              <div>
                <small>Recommended Action</small>
                <strong>{solverData.gto.recommendedAction.toUpperCase()}</strong>
                <p>
                  {(solverData.gto.equity * 100).toFixed(1)}% equity ·{" "}
                  {(solverData.confidence * 100).toFixed(0)}% confidence ·{" "}
                  {solverData.gto.opponentRangeProfile}
                </p>
              </div>

              <div className="ls-solver-summary">
                <p>{solverData.analysis}</p>
                <div className="ls-tag-row">
                  {solverData.gto.tags.map((tag) => (
                    <span key={tag} className="ls-runtime-pill">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </section>

            <section className="ls-table-info-grid">
              <InfoTile label="Street" value={solverData.gto.street} />
              <InfoTile label="Pot Odds" value={formatPercent(solverData.gto.potOdds)} />
              <InfoTile
                label="Exploitability"
                value={solverData.gto.exploitability.toFixed(2)}
              />
              <InfoTile label="Trials" value={String(solverData.gto.trials)} />
            </section>

            <section className="ls-solver-grid">
              <article className="ls-panel ls-solver-card">
                <div className="ls-solver-card-header">
                  <h3>Strategy mix</h3>
                  <small>Frequency by action</small>
                </div>
                <div className="ls-solver-list">
                  {strategyRows.map(([action, weight]) => (
                    <div key={action} className="ls-solver-row">
                      <span>{action}</span>
                      <strong>{(weight * 100).toFixed(1)}%</strong>
                    </div>
                  ))}
                </div>
              </article>

              <article className="ls-panel ls-solver-card">
                <div className="ls-solver-card-header">
                  <h3>Action EVs</h3>
                  <small>Rollout expected value</small>
                </div>
                <div className="ls-solver-list">
                  {evRows.map(([action, value]) => (
                    <div key={action} className="ls-solver-row">
                      <span>{action}</span>
                      <strong>{value.toFixed(2)}</strong>
                    </div>
                  ))}
                </div>
              </article>

              <article className="ls-panel ls-solver-card">
                <div className="ls-solver-card-header">
                  <h3>Counterfactual regret</h3>
                  <small>Pressure points in the abstraction</small>
                </div>
                <div className="ls-solver-list">
                  {regretRows.map(([action, value]) => (
                    <div key={action} className="ls-solver-row">
                      <span>{action}</span>
                      <strong>{value.toFixed(2)}</strong>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <div className="ls-solver-recommendations">
              {solverData.gto.recommendations.map((recommendation) => (
                <article key={recommendation.action} className="ls-panel ls-solver-tip">
                  <strong>
                    {recommendation.action.toUpperCase()} · {recommendation.frequency}
                  </strong>
                  <p>{recommendation.description}</p>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="ls-hand-list">
        {loading && hands.length === 0 && (
          <div className="ls-empty-card">
            <strong>Loading hand history…</strong>
            <p>Pulling recent hands and analytics from the table ledger.</p>
          </div>
        )}

        {!loading && hands.length === 0 && (
          <div className="ls-empty-card">
            <strong>No hands recorded yet.</strong>
            <p>Play a few hands to unlock replays, trend lines, and session stats.</p>
          </div>
        )}

        {hands.map((hand) => (
          <article key={hand.id} className="ls-hand-card">
            <div className="ls-hand-left">
              <div className="ls-hole-cards">{formatCards(hand.holeCards)}</div>
              <div>
                <strong>{formatCards(hand.board)}</strong>
                <p>
                  {handInsight(hand)} · {hand.phaseReached} · {hand.resolution}
                </p>
              </div>
            </div>

            <div className={`ls-hand-result ${hand.result === "win" ? "win" : hand.result === "loss" ? "loss" : ""}`}>
              <strong>{formatCurrency(hand.netAmount)}</strong>
              <span>{hand.result.slice(0, 1).toUpperCase()}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function LeaderboardView({
  leaderboard,
  viewerRank,
  currentFid,
  bestFriends,
}: {
  leaderboard: ReturnType<typeof usePokerProductData>["leaderboard"];
  viewerRank: ReturnType<typeof usePokerProductData>["viewerRank"];
  currentFid: number;
  bestFriends: ReturnType<typeof usePokerProductData>["bestFriends"];
}) {
  const podium = leaderboard.slice(0, 3);

  return (
    <div className="ls-view">
      <div className="ls-view-header">
        <div>
          <p className="ls-eyebrow">Social Edge</p>
          <h2>Leaderboard</h2>
          <p>First-party rankings, streaks, and your Farcaster social rail.</p>
        </div>
        <div className="ls-filter-summary">
          <strong>{viewerRank ? `#${viewerRank}` : "—"}</strong>
          <small>Your rank</small>
        </div>
      </div>

      <section className="ls-podium">
        {podium.length === 0 ? (
          <div className="ls-empty-card">
            <strong>No ranked players yet.</strong>
            <p>Once hand history resolves, the leaderboard populates automatically.</p>
          </div>
        ) : (
          podium.map((player) => (
            <div key={player.rank} className={`ls-podium-card rank-${player.rank}`}>
              <span>{player.rank}</span>
              <strong>{player.username}</strong>
              <b>{formatCurrency(player.netWinnings)}</b>
              <small>{leaderboardTag(player)}</small>
            </div>
          ))
        )}
      </section>

      {bestFriends.length > 0 && (
        <section className="ls-friends-strip">
          <div className="ls-friends-header">
            <strong>Squad radar</strong>
            <small>Your top Farcaster connections</small>
          </div>
          <div className="ls-friends-list">
            {bestFriends.map((friend) => (
              <div key={friend.user.fid} className="ls-friend-chip">
                <strong>{friend.user.username}</strong>
                <small>FID {friend.user.fid}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="ls-rank-list">
        {leaderboard.map((player) => (
          <div
            key={player.fid}
            className={player.fid === currentFid ? "ls-rank-row you" : "ls-rank-row"}
          >
            <span>#{player.rank}</span>
            <div className="ls-rank-avatar">{player.username.slice(0, 1)}</div>
            <div>
              <strong>{player.username}</strong>
              <small>
                {player.handsPlayed} hands · {formatPercent(player.handsWon / Math.max(player.handsPlayed, 1))} win rate
              </small>
            </div>
            <b>{formatCurrency(player.netWinnings)}</b>
          </div>
        ))}
      </section>
    </div>
  );
}

function ProfileView({
  user,
  tableCount,
  seatedTable,
  dashboard,
  analytics,
  bestFriendCount,
}: {
  user: ReturnType<typeof useUniversalUser>;
  tableCount: number;
  seatedTable?: PokerTable;
  dashboard: ReturnType<typeof usePokerProductData>["dashboard"];
  analytics: ReturnType<typeof usePokerProductData>["analytics"];
  bestFriendCount: number;
}) {
  return (
    <div className="ls-view">
      <div className="ls-view-header">
        <div>
          <p className="ls-eyebrow">Universal Profile</p>
          <h2>{user.displayName}</h2>
          <p>
            Identity resolves from Farcaster first, then wallet, then browser guest.
          </p>
        </div>
      </div>

      <section className="ls-profile-grid">
        <InfoTile label="Runtime" value={humanRuntimeLabel(user.runtimeHost)} />
        <InfoTile label="Auth Source" value={user.authSource} />
        <InfoTile label="FID" value={String(user.fid)} />
        <InfoTile
          label="Wallet"
          value={shortAddress(user.walletAddress) ?? "None"}
        />
        <InfoTile label="Hands Played" value={String(dashboard?.handsPlayed ?? 0)} />
        <InfoTile label="Win Rate" value={formatPercent(dashboard?.winRate ?? 0)} />
        <InfoTile label="14D Net / 100" value={(analytics?.netPer100Hands ?? 0).toFixed(1)} />
        <InfoTile label="Best Friends" value={String(bestFriendCount)} />
        <InfoTile label="Current Table" value={seatedTable?.name ?? "None"} />
        <InfoTile label="Tables Online" value={String(tableCount)} />
      </section>

      <section className="ls-resilience-card">
        <span>✦</span>
        <div>
          <strong>Chemist’s mind. Player’s heart. Analyst’s edge.</strong>
          <p>
            Built for range study, bankroll discipline, table selection, cross-chain
            identity, and real-time social poker. This build now surfaces the
            first-party baseline pro apps rely on: lobby filters, hand history,
            leaderboard stats, and social identity.
          </p>
        </div>
      </section>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="ls-info-tile">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function MiniGraph({ analytics }: { analytics: AnalyticsData | null }) {
  const linePoints = buildGraphPoints(analytics);
  const fillPath = buildGraphAreaPath(analytics);
  return (
    <svg className="ls-mini-graph" viewBox="0 0 320 120" preserveAspectRatio="none">
      <defs>
        <linearGradient id="lsGraphLine" x1="0" x2="1">
          <stop offset="0%" stopColor="#1bdcff" />
          <stop offset="55%" stopColor="#20f0bd" />
          <stop offset="100%" stopColor="#8c5cff" />
        </linearGradient>

        <linearGradient id="lsGraphFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#20f0bd" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#20f0bd" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path
        d={fillPath}
        fill="url(#lsGraphFill)"
      />

      <polyline
        points={linePoints}
        fill="none"
        stroke="url(#lsGraphLine)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MobileBottomNav({
  activeTab,
  setActiveTab,
}: {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
}) {
  const tabs: { id: Tab; icon: string; label: string }[] = [
    { id: "lobby", icon: "◆", label: "Lobby" },
    { id: "table", icon: "♠", label: "Table" },
    { id: "analysis", icon: "◎", label: "Study" },
    { id: "leaderboard", icon: "▥", label: "Ranks" },
    { id: "profile", icon: "✦", label: "You" },
  ];

  return (
    <nav className="ls-mobile-nav">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={activeTab === tab.id ? "active" : ""}
          onClick={() => setActiveTab(tab.id)}
          type="button"
        >
          <span>{tab.icon}</span>
          <small>{tab.label}</small>
        </button>
      ))}
    </nav>
  );
}
