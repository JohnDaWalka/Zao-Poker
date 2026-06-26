"use client";

import { useEffect, useMemo, useState } from "react";
import { ConnectWallet } from "~/components/ui/wallet/ConnectWallet";
import { useMiniAppReady } from "~/hooks/useMiniAppReady";
import { useRenderLobby, type PokerTable } from "~/hooks/useRenderLobby";
import { useUniversalUser } from "~/hooks/useUniversalUser";

type Tab = "lobby" | "table" | "analysis" | "leaderboard" | "profile";

const mockLeaderboard = [
  { rank: 1, name: "NeonChemist", profit: "$247,890", tag: "Orbit Crusher" },
  { rank: 2, name: "CryptoAce", profit: "$186,745", tag: "Chain Grinder" },
  { rank: 3, name: "DataStack", profit: "$153,210", tag: "Solver Mind" },
  { rank: 4, name: "RangeWizard", profit: "$131,875", tag: "Range Boss" },
  { rank: 5, name: "You", profit: "$87,420", tag: "Leak Hunter" },
];

const mockHands = [
  {
    hand: "K♠ K♦",
    board: "K♣ 9♠ 7♥ 2♠ K♥",
    result: "+$237.50",
    note: "Turn call was thin but river realization was clean.",
    grade: "A-",
  },
  {
    hand: "A♠ T♠",
    board: "Q♠ 8♠ 3♦ 4♣ 2♠",
    result: "+$91.20",
    note: "Nut-flush draw aggression generated fold equity.",
    grade: "B+",
  },
  {
    hand: "7♦ 7♣",
    board: "A♥ J♠ 7♠ 6♣ 2♦",
    result: "+$164.80",
    note: "Set extraction line was strong versus capped range.",
    grade: "A",
  },
];

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

  const [activeTab, setActiveTab] = useState<Tab>("lobby");
  const [activeTableId, setActiveTableId] = useState<string | null>(null);

  const tables = lobby.state.tables;

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
              tables={tables}
              activeTableId={activeTable?.id ?? null}
              seatedTableId={seatedTable?.id ?? null}
              canCreate={lobby.supportsTableCreation}
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

          {activeTab === "analysis" && <AnalysisView />}

          {activeTab === "leaderboard" && <LeaderboardView />}

          {activeTab === "profile" && (
            <ProfileView
              user={user}
              tableCount={tables.length}
              seatedTable={seatedTable}
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
  onCreate,
  onSelect,
  onJoin,
}: {
  tables: PokerTable[];
  activeTableId: string | null;
  seatedTableId: string | null;
  canCreate: boolean;
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

      <div className="ls-lobby-grid">
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
                <span>${table.buyIn} buy-in</span>
                <span>
                  {occupied}/{table.maxPlayers} seated
                </span>
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
                ? seat.isReady
                  ? "Ready"
                  : `$${seat.stack} stack`
                : "Available"}
            </small>
          </div>
        ))}
      </section>

      <section className="ls-table-info-grid">
        <InfoTile label="Game" value={table.game} />
        <InfoTile label="Stakes" value={table.stakes} />
        <InfoTile label="Buy-in" value={`$${table.buyIn}`} />
        <InfoTile label="Status" value={getStatusLabel(table.status)} />
      </section>
    </div>
  );
}

function AnalysisView() {
  return (
    <div className="ls-view">
      <div className="ls-view-header">
        <div>
          <p className="ls-eyebrow">Hand Intelligence</p>
          <h2>Recent analysis</h2>
          <p>Review EV, board texture, leak notes, and decision grades.</p>
        </div>
      </div>

      <section className="ls-analysis-hero">
        <div>
          <small>Session EV</small>
          <strong>+$487.30</strong>
          <p>Last 342 hands · +18.4 bb/100</p>
        </div>

        <MiniGraph />
      </section>

      <div className="ls-hand-list">
        {mockHands.map((hand) => (
          <article key={`${hand.hand}-${hand.board}`} className="ls-hand-card">
            <div className="ls-hand-left">
              <div className="ls-hole-cards">{hand.hand}</div>
              <div>
                <strong>{hand.board}</strong>
                <p>{hand.note}</p>
              </div>
            </div>

            <div className="ls-hand-result">
              <strong>{hand.result}</strong>
              <span>{hand.grade}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function LeaderboardView() {
  return (
    <div className="ls-view">
      <div className="ls-view-header">
        <div>
          <p className="ls-eyebrow">Social Edge</p>
          <h2>Leaderboard</h2>
          <p>Friends, squads, and global rankings.</p>
        </div>
      </div>

      <section className="ls-podium">
        {mockLeaderboard.slice(0, 3).map((player) => (
          <div key={player.rank} className={`ls-podium-card rank-${player.rank}`}>
            <span>{player.rank}</span>
            <strong>{player.name}</strong>
            <b>{player.profit}</b>
            <small>{player.tag}</small>
          </div>
        ))}
      </section>

      <section className="ls-rank-list">
        {mockLeaderboard.map((player) => (
          <div
            key={player.rank}
            className={player.name === "You" ? "ls-rank-row you" : "ls-rank-row"}
          >
            <span>#{player.rank}</span>
            <div className="ls-rank-avatar">{player.name.slice(0, 1)}</div>
            <div>
              <strong>{player.name}</strong>
              <small>{player.tag}</small>
            </div>
            <b>{player.profit}</b>
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
}: {
  user: ReturnType<typeof useUniversalUser>;
  tableCount: number;
  seatedTable?: PokerTable;
}) {
  return (
    <div className="ls-view">
      <div className="ls-view-header">
        <div>
          <p className="ls-eyebrow">Universal Profile</p>
          <h2>{user.displayName}</h2>
          <p>
            Identity resolves from Farcaster first, then wallet, then browser
            guest.
          </p>
        </div>
      </div>

      <section className="ls-profile-grid">
        <InfoTile label="Runtime" value={humanRuntimeLabel(user.runtimeHost)} />
        <InfoTile label="Auth Source" value={user.authSource} />
        <InfoTile
          label="FID"
          value={user.authSource === "farcaster" ? String(user.fid) : "None"}
        />
        <InfoTile
          label="Wallet"
          value={shortAddress(user.walletAddress) ?? "None"}
        />
        <InfoTile label="Tables Online" value={String(tableCount)} />
        <InfoTile label="Current Table" value={seatedTable?.name ?? "None"} />
      </section>

      <section className="ls-resilience-card">
        <span>✦</span>
        <div>
          <strong>Chemist’s mind. Player’s heart. Analyst’s edge.</strong>
          <p>
            Built for range study, bankroll discipline, table selection,
            cross-chain identity, and real-time social poker.
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

function MiniGraph() {
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
        d="M0,88 L32,82 L64,92 L96,61 L128,66 L160,48 L192,55 L224,36 L256,42 L288,22 L320,28 L320,120 L0,120 Z"
        fill="url(#lsGraphFill)"
      />

      <polyline
        points="0,88 32,82 64,92 96,61 128,66 160,48 192,55 224,36 256,42 288,22 320,28"
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
