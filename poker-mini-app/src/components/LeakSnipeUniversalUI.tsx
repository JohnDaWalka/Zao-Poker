"use client";

import { useEffect, useMemo, useState } from "react";
import {
  usePokerProductData,
  type AnalyticsData,
  type HandHistoryEntry,
  type LeaderboardEntry,
} from "~/hooks/usePokerProductData";
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
  const lobby = useRenderLobby();
  const productData = usePokerProductData(user.fid, user.authSource);

  const [activeTab, setActiveTab] = useState<Tab>("lobby");
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [lobbySearch, setLobbySearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TableStatus>("all");
  const [gameFilter, setGameFilter] = useState<"all" | GameType>("all");

  const tables = lobby.state.tables;
  const filteredTables = useMemo(() => {
    return tables.filter((table) => {
      const matchesSearch =
        lobbySearch.trim().length === 0 ||
        table.name.toLowerCase().includes(lobbySearch.trim().toLowerCase()) ||
        table.stakes.toLowerCase().includes(lobbySearch.trim().toLowerCase());
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

  useEffect(() => {
    if (!activeTableId && seatedTable) {
      setActiveTableId(seatedTable.id);
      return;
    }

    if (!activeTableId && tables[0]) {
      setActiveTableId(tables[0].id);
    }
  }, [activeTableId, seatedTable, tables]);

  function createTable() {
    void lobby.createTable({
      name: "Neon Felt Table",
      game: "NLHE",
      stakes: "$0.10 / $0.25",
      maxPlayers: 6,
      buyIn: 25,
    }, user);
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
              searchValue={lobbySearch}
              statusFilter={statusFilter}
              gameFilter={gameFilter}
              totalTables={tables.length}
              onSearchChange={setLobbySearch}
              onStatusFilterChange={setStatusFilter}
              onGameFilterChange={setGameFilter}
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
  searchValue,
  statusFilter,
  gameFilter,
  totalTables,
  onSearchChange,
  onStatusFilterChange,
  onGameFilterChange,
  onCreate,
  onSelect,
  onJoin,
}: {
  tables: PokerTable[];
  activeTableId: string | null;
  seatedTableId: string | null;
  canCreate: boolean;
  searchValue: string;
  statusFilter: "all" | TableStatus;
  gameFilter: "all" | GameType;
  totalTables: number;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: "all" | TableStatus) => void;
  onGameFilterChange: (value: "all" | GameType) => void;
  onCreate: () => void;
  onSelect: (table: PokerTable) => void;
  onJoin: (table: PokerTable) => void;
}) {
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
          + Create Table
        </button>
      </div>

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
  userId,
  supportsReadyState,
  onJoin,
  onLeave,
  onReady,
}: {
  table: PokerTable;
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
    </div>
  );
}

function AnalysisView({
  loading,
  dashboard,
  analytics,
  hands,
}: {
  loading: boolean;
  dashboard: ReturnType<typeof usePokerProductData>["dashboard"];
  analytics: ReturnType<typeof usePokerProductData>["analytics"];
  hands: ReturnType<typeof usePokerProductData>["hands"];
}) {
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
