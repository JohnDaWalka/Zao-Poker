"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function LeakSnipeUniversalUI() {
  useMiniAppReady();

  const user = useUniversalUser();
  const [activeTab, setActiveTab] = useState<Tab>("lobby");
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [lobbySearch, setLobbySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TableStatus>("all");
  const [gameFilter, setGameFilter] = useState<"all" | GameType>("all");
  const lobby = useRenderLobby(user);
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
    return tables.find((table) => table.id === activeTableId) ?? tables[0] ?? null;
  }, [activeTableId, tables]);

  const seatedTable = useMemo(() => {
    return tables.find((table) =>
      table.seats.some((seat) => seat.user?.id === user.id)
    );
  }, [tables, user.id]);

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

  function joinTable(table: PokerTable) {
    void lobby.joinTable(table.id, user);
    setActiveTableId(table.id);
    setActiveTab("table");
  }

  function leaveTable(table: PokerTable) {
    void lobby.leaveTable(table.id, user);
  }

  function toggleReady(table: PokerTable) {
    void lobby.toggleReady(table.id, user);
  }

  return (
    <main className="ls-shell">
      <div className="ls-bg-molecule ls-bg-molecule-a">HO—N—CH₃</div>
      <div className="ls-bg-molecule ls-bg-molecule-b">C₂₁H₃₀O₂ · EDGE</div>
      <div className="ls-bg-film">ILFORD HP5 PLUS · 400TX</div>

      <section className="ls-hero">
        <div className="ls-brand-block">
          <div className="ls-logo">
            <span>♠</span>
          </div>

          <div>
            <p className="ls-eyebrow">Cross-chain poker intelligence</p>
            <h1>LeakSnipe</h1>
            <p className="ls-hero-copy">
              A universal poker mini-app for Farcaster, iOS Safari, Android,
              desktop browsers, and wallet-enabled web.
            </p>
          </div>
        </div>

        <UniversalIdentityCard user={user} />
      </section>

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
            <TableView
              table={activeTable}
              user={user}
              userId={user.id}
              supportsReadyState={lobby.supportsReadyState}
              onJoin={() => joinTable(activeTable)}
              onLeave={() => leaveTable(activeTable)}
              onReady={() => toggleReady(activeTable)}
            />
          )}

          {activeTab === "analysis" && (
            <AnalysisView
              loading={productData.loading}
              dashboard={productData.dashboard}
              analytics={productData.analytics}
              hands={productData.hands}
              table={activeTable}
              userId={user.id}
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
      <div className="ls-view-header">
        <div>
          <p className="ls-eyebrow">Live Lobby</p>
          <h2>Choose your table</h2>
          <p>
            Cross-device poker access with Farcaster, wallet, and browser guest
            identity.
          </p>
        </div>

        <button
          className="ls-primary-button"
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
              className="ls-secondary-button"
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
              className="ls-primary-button"
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
                      className="ls-secondary-button"
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
                        className="ls-danger-button"
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
                          className="ls-secondary-button"
                          disabled={clubMutating === `report:${report.id}:dismissed`}
                          onClick={() => void reviewReport(report.id, "dismissed")}
                          type="button"
                        >
                          {clubMutating === `report:${report.id}:dismissed` ? "Dismissing…" : "Dismiss"}
                        </button>
                        <button
                          className="ls-primary-button"
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
                  className="ls-secondary-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(table);
                  }}
                  type="button"
                >
                  View
                </button>

                <button
                  className="ls-primary-button"
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

function TableView({
  table,
  user,
  userId,
  supportsReadyState,
  onJoin,
  onLeave,
  onReady,
}: {
  table: PokerTable;
  user: ReturnType<typeof useUniversalUser>;
  userId: string;
  supportsReadyState: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onReady: () => void;
}) {
  const currentSeat = table.seats.find((seat) => seat.user?.id === userId);
  const occupied = occupiedSeats(table);
  const readyCount = table.seats.filter((seat) => seat.user && seat.isReady).length;
  const isFull = occupied >= table.maxPlayers;
  const chat = useTableChat(table.id, user.fid);
  const [draftMessage, setDraftMessage] = useState("");
  const [reportedMessageIds, setReportedMessageIds] = useState<number[]>([]);

  const visibleMessages = useMemo(
    () => chat.messages.filter((message) => !chat.mutedFids.includes(message.fid)),
    [chat.messages, chat.mutedFids],
  );

  const mutedPlayers = useMemo(() => {
    const players = new Map<number, string>();
    for (const message of chat.messages) {
      if (chat.mutedFids.includes(message.fid) && !players.has(message.fid)) {
        players.set(message.fid, message.username);
      }
    }
    return Array.from(players.entries()).map(([fid, username]) => ({ fid, username }));
  }, [chat.messages, chat.mutedFids]);

  async function submitChatMessage() {
    const trimmed = draftMessage.trim();
    if (!trimmed) {
      return;
    }

    try {
      await chat.sendMessage(user, trimmed);
      setDraftMessage("");
    } catch {
      // The hook already surfaces the error state for the panel.
    }
  }

  async function mutePlayer(targetFid: number) {
    try {
      await chat.mutePlayer(user, targetFid);
    } catch {
      // The hook already exposes the moderation error state.
    }
  }

  async function unmutePlayer(targetFid: number) {
    try {
      await chat.unmutePlayer(user, targetFid);
    } catch {
      // The hook already exposes the moderation error state.
    }
  }

  async function reportMessage(messageId: number, targetFid: number) {
    try {
      await chat.reportMessage(user, messageId, targetFid);
      setReportedMessageIds((current) => (current.includes(messageId) ? current : [...current, messageId]));
    } catch {
      // The hook already exposes the moderation error state.
    }
  }

  return (
    <div className="ls-view">
      <div className="ls-view-header">
        <div>
          <p className="ls-eyebrow">Selected Table</p>
          <h2>{table.name}</h2>
          <p>
            {table.game} · {table.stakes} · {occupied}/{table.maxPlayers} seated
          </p>
          <p>{formatStartTime(table.startTime)}</p>
        </div>

        <div className="ls-action-row">
          {!currentSeat && (
            <button
              className="ls-primary-button"
              onClick={onJoin}
              disabled={isFull || table.status === "in_game"}
              type="button"
            >
              {isFull ? "Full" : "Take Seat"}
            </button>
          )}

          {currentSeat && supportsReadyState && (
            <button className="ls-secondary-button" onClick={onReady} type="button">
              {currentSeat.isReady ? "Unready" : "Ready"}
            </button>
          )}

          {currentSeat && (
            <button
              className="ls-danger-button"
              onClick={onLeave}
              disabled={table.status === "in_game"}
              type="button"
            >
              Leave
            </button>
          )}
        </div>
      </div>

      {!supportsReadyState && (
        <div className="ls-runtime-pill">
          This table is running in the current Vercel-compatible fallback mode.
        </div>
      )}

      <section className="ls-felt-table">
        <div className="ls-dealer-core">
          <span>♠</span>
          <strong>{readyCount} ready</strong>
          <small>
            {table.status === "in_game" ? "Hand in progress" : "Waiting for players"}
          </small>
        </div>

        {table.seats.map((seat) => (
          <div key={seat.seatNumber} className={`ls-seat ls-seat-${seat.seatNumber}`}>
            <div className={seat.user ? "ls-seat-avatar filled" : "ls-seat-avatar"}>
              {seat.user?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={seat.user.avatarUrl} alt={seat.user.displayName} />
              ) : seat.user ? (
                seat.user.displayName.slice(0, 1)
              ) : (
                seat.seatNumber
              )}
            </div>

            <strong>{seat.user?.displayName ?? "Open Seat"}</strong>
            <small>
              {seat.user
                ? seat.isBot
                  ? `Autoplay bot · ${formatCurrency(seat.stack)}`
                  : seat.isReady
                  ? "Ready"
                  : `${formatCurrency(seat.stack)} stack`
                : "Available"}
            </small>
          </div>
        ))}
      </section>

      <section className="ls-table-info-grid">
        <InfoTile label="Game" value={table.game} />
        <InfoTile label="Stakes" value={table.stakes} />
        <InfoTile label="Buy-in" value={formatCurrency(table.buyIn)} />
        <InfoTile label="Status" value={getStatusLabel(table.status)} />
      </section>

      <section className="ls-chat-panel">
        <div className="ls-chat-header">
          <div>
            <p className="ls-eyebrow">Table Chat</p>
            <h3>Rail talk</h3>
          </div>
          <small>{currentSeat ? "Seated players can post." : "Take a seat to join chat."}</small>
        </div>

        {mutedPlayers.length > 0 && (
          <div className="ls-chat-muted-row">
            <small>Muted players</small>
            <div className="ls-chat-muted-list">
              {mutedPlayers.map((player) => (
                <button
                  key={player.fid}
                  className="ls-chat-chip"
                  disabled={chat.moderating === player.fid}
                  onClick={() => void unmutePlayer(player.fid)}
                  type="button"
                >
                  {chat.moderating === player.fid ? `Updating ${player.username}…` : `Unmute ${player.username}`}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ls-chat-stream">
          {chat.loading && visibleMessages.length === 0 && (
            <div className="ls-empty-card">
              <strong>Loading table chat…</strong>
              <p>Pulling the latest messages from the current table.</p>
            </div>
          )}

          {!chat.loading && visibleMessages.length === 0 && mutedPlayers.length === 0 && (
            <div className="ls-empty-card">
              <strong>No table chat yet.</strong>
              <p>Break the silence with a quick GLHF once you take a seat.</p>
            </div>
          )}

          {!chat.loading && visibleMessages.length === 0 && mutedPlayers.length > 0 && (
            <div className="ls-empty-card">
              <strong>All current chat is muted.</strong>
              <p>Use the muted-player pills above to restore messages from specific players.</p>
            </div>
          )}

          {visibleMessages.map((message) => {
            const isSelf = message.fid === user.fid;
            const isReported = reportedMessageIds.includes(message.id);
            return (
              <article
                key={message.id}
                className={isSelf ? "ls-chat-message self" : "ls-chat-message"}
              >
                <div className="ls-chat-avatar">
                  {message.pfpUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={message.pfpUrl} alt={message.username} />
                  ) : (
                    message.username.slice(0, 1).toUpperCase()
                  )}
                </div>

                <div className="ls-chat-bubble">
                  <div className="ls-chat-meta">
                    <strong>{message.username}</strong>
                    <span>
                      {message.isBot ? "Bot" : "Player"} · {formatChatTime(message.createdAt)}
                    </span>
                  </div>
                  <p>{message.message}</p>
                  {!isSelf && !message.isBot && currentSeat && (
                    <div className="ls-chat-moderation-row">
                      <button
                        className="ls-chat-inline-action"
                        disabled={chat.moderating === message.fid || chat.mutedFids.includes(message.fid)}
                        onClick={() => void mutePlayer(message.fid)}
                        type="button"
                      >
                        {chat.mutedFids.includes(message.fid)
                          ? "Muted"
                          : chat.moderating === message.fid
                            ? "Muting…"
                            : "Mute"}
                      </button>
                      <button
                        className="ls-chat-inline-action"
                        disabled={chat.moderating === message.fid || isReported}
                        onClick={() => void reportMessage(message.id, message.fid)}
                        type="button"
                      >
                        {isReported
                          ? "Reported"
                          : chat.moderating === message.fid
                            ? "Reporting…"
                            : "Report"}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <form
          className="ls-chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submitChatMessage();
          }}
        >
          <textarea
            className="ls-chat-input"
            disabled={!currentSeat || chat.sending}
            maxLength={280}
            onChange={(event) => setDraftMessage(event.target.value)}
            placeholder={
              currentSeat
                ? "Type table chat…"
                : "Take a seat before posting in table chat."
            }
            value={draftMessage}
          />

          <div className="ls-chat-actions">
            <small>{draftMessage.trim().length}/280</small>
            <button
              className="ls-primary-button"
              disabled={!currentSeat || chat.sending || draftMessage.trim().length === 0}
              type="submit"
            >
              {chat.sending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>

        {chat.error && <div className="ls-error">{chat.error}</div>}
      </section>
    </div>
  );
}

function AnalysisView({
  loading,
  dashboard,
  analytics,
  hands,
  table,
  userId,
}: {
  loading: boolean;
  dashboard: ReturnType<typeof usePokerProductData>["dashboard"];
  analytics: ReturnType<typeof usePokerProductData>["analytics"];
  hands: ReturnType<typeof usePokerProductData>["hands"];
  table: PokerTable | null;
  userId: string;
}) {
  const [solverData, setSolverData] = useState<SolverPanelData | null>(null);
  const [solverLoading, setSolverLoading] = useState(false);
  const [solverError, setSolverError] = useState<string | null>(null);

  const currentSeat = useMemo(
    () => table?.seats.find((seat) => seat.user?.id === userId) ?? null,
    [table, userId],
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
      try {
        const response = await fetch("/api/analyze", {
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

            <div className="ls-hand-result">
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
