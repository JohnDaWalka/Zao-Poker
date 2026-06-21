import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TheoryChartResult } from "../lib/api";

const RANKS = "AKQJT98765432";
const STORAGE_KEY = "leaksnipe.range-studio.charts.v1";
const COLOR_STORAGE_KEY = "leaksnipe.range-studio.colors.v1";
const ACTION_ORDER = ["fold", "push", "open", "call", "defend", "3bet"];

const DEFAULT_COLORS: Record<string, string> = {
  fold: "#334155",
  push: "#ef4444",
  open: "#22c55e",
  call: "#3b82f6",
  defend: "#14b8a6",
  "3bet": "#a855f7",
};

const COLOR_THEMES: Record<string, Record<string, string>> = {
  Classic: DEFAULT_COLORS,
  "Color safe": {
    fold: "#374151",
    push: "#e69f00",
    open: "#009e73",
    call: "#56b4e9",
    defend: "#0072b2",
    "3bet": "#cc79a7",
  },
  Neon: {
    fold: "#293548",
    push: "#ff3b69",
    open: "#39ff88",
    call: "#32b8ff",
    defend: "#20e3d1",
    "3bet": "#c15cff",
  },
};

type AllocationMap = Record<string, number>;

type StudioCell = {
  notation: string;
  allocations: AllocationMap;
  source: string;
  nnValuePct?: number;
};

type SavedStudioChart = {
  version: 1;
  id: string;
  name: string;
  stackBb: number;
  position: string;
  mode: string;
  referenceSource: string;
  actions: string[];
  colors: Record<string, string>;
  cells: Record<string, StudioCell>;
  locked: string[];
  savedAt: string;
};

type RangeStudioProps = {
  chart: TheoryChartResult | null;
  loading: boolean;
  depths: number[];
  stackBb: number;
  position: string;
  positions: readonly string[];
  onStackChange: (depth: number) => void;
  onPositionChange: (position: string) => void;
  onHandSelect: (notation: string) => void;
};

function clampFrequency(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function normalizedAllocations(values: AllocationMap): AllocationMap {
  const cleaned = Object.fromEntries(
    Object.entries(values)
      .map(([action, value]) => [action, clampFrequency(value)] as const)
      .filter(([, value]) => value > 0.0001),
  );
  const total = Object.values(cleaned).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return { fold: 1 };
  return Object.fromEntries(
    Object.entries(cleaned).map(([action, value]) => [action, value / total]),
  );
}

function chartToStudioCells(chart: TheoryChartResult): Record<string, StudioCell> {
  return Object.fromEntries(
    Object.entries(chart.cells).map(([notation, cell]) => {
      const frequency = clampFrequency(cell.freq);
      const allocations =
        cell.action === "fold"
          ? { fold: 1 }
          : normalizedAllocations({ [cell.action]: frequency, fold: 1 - frequency });
      return [
        notation,
        {
          notation,
          allocations,
          source: cell.source ?? chart.source,
          nnValuePct: cell.nn_value_pct,
        },
      ];
    }),
  );
}

function allocationDistance(left: AllocationMap, right: AllocationMap): number {
  const actions = new Set([...Object.keys(left), ...Object.keys(right)]);
  let total = 0;
  actions.forEach((action) => {
    total += Math.abs((left[action] ?? 0) - (right[action] ?? 0));
  });
  return total / 2;
}

function sameAllocation(left: AllocationMap, right: AllocationMap): boolean {
  return allocationDistance(left, right) < 0.005;
}

function scoreStudio(
  cells: Record<string, StudioCell>,
  baseline: Record<string, StudioCell>,
) {
  const notations = Object.keys(baseline);
  if (!notations.length) return { score: 100, averageDifference: 0, exact: 0, overrides: 0 };
  let distance = 0;
  let exact = 0;
  let overrides = 0;
  notations.forEach((notation) => {
    const delta = allocationDistance(
      cells[notation]?.allocations ?? { fold: 1 },
      baseline[notation]?.allocations ?? { fold: 1 },
    );
    distance += delta;
    if (delta <= 0.01) exact += 1;
    if (delta >= 0.005) overrides += 1;
  });
  const averageDifference = distance / notations.length;
  return {
    score: Math.max(0, 100 * (1 - averageDifference)),
    averageDifference: averageDifference * 100,
    exact,
    overrides,
  };
}

function dominantAllocation(allocations: AllocationMap): [string, number] {
  return (
    Object.entries(allocations).sort((left, right) => right[1] - left[1])[0] ?? ["fold", 1]
  );
}

function cellBackground(
  allocations: AllocationMap,
  colors: Record<string, string>,
  actions: string[],
): string {
  const entries = actions
    .map((action) => [action, allocations[action] ?? 0] as const)
    .filter(([, value]) => value > 0.001);
  if (!entries.length) return colors.fold ?? DEFAULT_COLORS.fold;
  if (entries.length === 1) return colors[entries[0][0]] ?? DEFAULT_COLORS.fold;

  let cursor = 0;
  const stops: string[] = [];
  entries.forEach(([action, value]) => {
    const start = cursor * 100;
    cursor += value;
    const end = cursor * 100;
    const color = colors[action] ?? DEFAULT_COLORS.fold;
    stops.push(`${color} ${start.toFixed(1)}%`, `${color} ${end.toFixed(1)}%`);
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function paintedAllocation(action: string, frequency: number): AllocationMap {
  const value = clampFrequency(frequency);
  if (action === "fold") return { fold: 1 };
  return normalizedAllocations({ [action]: value, fold: 1 - value });
}

function rebalanceAllocation(
  allocations: AllocationMap,
  changedAction: string,
  nextValue: number,
  actions: string[],
): AllocationMap {
  const value = clampFrequency(nextValue);
  const otherActions = actions.filter((action) => action !== changedAction);
  const remaining = 1 - value;
  const otherTotal = otherActions.reduce((sum, action) => sum + (allocations[action] ?? 0), 0);
  const next: AllocationMap = { [changedAction]: value };

  if (remaining > 0 && otherTotal > 0) {
    otherActions.forEach((action) => {
      next[action] = ((allocations[action] ?? 0) / otherTotal) * remaining;
    });
  } else if (remaining > 0) {
    const fallback =
      changedAction === "fold"
        ? actions.find((action) => action !== "fold") ?? "call"
        : "fold";
    next[fallback] = remaining;
  }
  return normalizedAllocations(next);
}

function isCategory(notation: string, category: string): boolean {
  const isPair = notation.length === 2;
  if (category === "all") return true;
  if (category === "pairs") return isPair;
  if (category === "suited") return notation.endsWith("s");
  if (category === "offsuit") return notation.endsWith("o");
  if (category === "broadway") {
    const ranks = notation.slice(0, 2);
    return ranks.split("").every((rank) => "AKQJT".includes(rank));
  }
  return false;
}

function labelAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function readColors(): Record<string, string> {
  if (typeof window === "undefined") return DEFAULT_COLORS;
  try {
    return { ...DEFAULT_COLORS, ...JSON.parse(window.localStorage.getItem(COLOR_STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULT_COLORS;
  }
}

function readSavedCharts(): SavedStudioChart[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? (value as SavedStudioChart[]) : [];
  } catch {
    return [];
  }
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `chart-${Date.now()}`;
}

function presetMode(depth: number): string {
  if (depth <= 10) return "Push / fold";
  if (depth <= 35) return "Push / open";
  return "Open / defend";
}

function validImportedChart(value: unknown): value is SavedStudioChart {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SavedStudioChart>;
  return (
    candidate.version === 1 &&
    typeof candidate.name === "string" &&
    typeof candidate.stackBb === "number" &&
    typeof candidate.position === "string" &&
    Array.isArray(candidate.actions) &&
    Boolean(candidate.cells && typeof candidate.cells === "object")
  );
}

function RangeGrid({
  cells,
  baseline,
  actions,
  colors,
  selected,
  locked,
  onStartPaint,
  onPaintOver,
}: {
  cells: Record<string, StudioCell>;
  baseline: Record<string, StudioCell>;
  actions: string[];
  colors: Record<string, string>;
  selected: string | null;
  locked: Set<string>;
  onStartPaint: (notation: string) => void;
  onPaintOver: (notation: string, buttons: number) => void;
}) {
  const grid = useMemo(() => {
    const rows: (StudioCell | null)[][] = Array.from({ length: 13 }, () =>
      Array.from({ length: 13 }, () => null),
    );
    Object.values(cells).forEach((cell) => {
      const first = RANKS.indexOf(cell.notation[0]);
      const second = RANKS.indexOf(cell.notation[1]);
      if (first < 0 || second < 0) return;
      if (cell.notation.length === 2) rows[first][second] = cell;
      else if (cell.notation.endsWith("s")) rows[first][second] = cell;
      else rows[second][first] = cell;
    });
    return rows;
  }, [cells]);

  return (
    <div className="range-chart-wrap range-studio-grid-wrap">
      <table className="range-chart range-studio-grid">
        <thead>
          <tr>
            <th />
            {RANKS.split("").map((rank) => (
              <th key={rank}>{rank}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, rowIndex) => (
            <tr key={RANKS[rowIndex]}>
              <th>{RANKS[rowIndex]}</th>
              {row.map((cell, columnIndex) => {
                if (!cell) return <td key={columnIndex} className="range-cell-slot empty" />;
                const [dominantAction, dominantFrequency] = dominantAllocation(cell.allocations);
                const modified = !sameAllocation(
                  cell.allocations,
                  baseline[cell.notation]?.allocations ?? { fold: 1 },
                );
                const breakdown = actions
                  .filter((action) => (cell.allocations[action] ?? 0) > 0.005)
                  .map((action) => `${labelAction(action)} ${(cell.allocations[action] * 100).toFixed(0)}%`)
                  .join(" · ");
                return (
                  <td key={columnIndex} className="range-cell-slot">
                    <button
                      type="button"
                      className={`range-cell${selected === cell.notation ? " selected" : ""}${modified ? " modified" : ""}${locked.has(cell.notation) ? " locked" : ""}`}
                      style={{ background: cellBackground(cell.allocations, colors, actions) }}
                      title={`${cell.notation}: ${breakdown} · ${modified ? "manual override" : cell.source}`}
                      aria-label={`${cell.notation}: ${breakdown}`}
                      onClick={(event) => {
                        if (event.detail === 0) onStartPaint(cell.notation);
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        onStartPaint(cell.notation);
                      }}
                      onPointerEnter={(event) => onPaintOver(cell.notation, event.buttons)}
                    >
                      <span className="range-cell-text">{cell.notation}</span>
                      <span className="range-cell-frequency">
                        {dominantAction === "fold" && dominantFrequency > 0.995
                          ? "fold"
                          : `${Math.round(dominantFrequency * 100)}%`}
                      </span>
                      {locked.has(cell.notation) ? <span className="range-cell-lock">◆</span> : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RangeStudio({
  chart,
  loading,
  depths,
  stackBb,
  position,
  positions,
  onStackChange,
  onPositionChange,
  onHandSelect,
}: RangeStudioProps) {
  const [cells, setCells] = useState<Record<string, StudioCell>>({});
  const [baseline, setBaseline] = useState<Record<string, StudioCell>>({});
  const [actions, setActions] = useState<string[]>(ACTION_ORDER);
  const [colors, setColors] = useState<Record<string, string>>(readColors);
  const [activeAction, setActiveAction] = useState("open");
  const [paintFrequency, setPaintFrequency] = useState(100);
  const [selected, setSelected] = useState<string | null>(null);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [undoHistory, setUndoHistory] = useState<Record<string, StudioCell>[]>([]);
  const [redoHistory, setRedoHistory] = useState<Record<string, StudioCell>[]>([]);
  const [savedCharts, setSavedCharts] = useState<SavedStudioChart[]>(readSavedCharts);
  const [activeSavedId, setActiveSavedId] = useState("");
  const [chartName, setChartName] = useState("");
  const [portableText, setPortableText] = useState("");
  const [newAction, setNewAction] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const paintingRef = useRef(false);
  const pendingSavedRef = useRef<SavedStudioChart | null>(null);

  const applySaved = useCallback((saved: SavedStudioChart) => {
    setCells(saved.cells);
    setActions(saved.actions);
    setColors((current) => ({ ...current, ...saved.colors }));
    setLocked(new Set(saved.locked));
    setChartName(saved.name);
    setActiveSavedId(saved.id);
    setUndoHistory([]);
    setRedoHistory([]);
    setSelected(null);
    setMessage(`Loaded ${saved.name}`);
  }, []);

  useEffect(() => {
    if (!chart) return;
    const nextBaseline = chartToStudioCells(chart);
    setBaseline(nextBaseline);
    const nextActions = [
      ...new Set([
        ...ACTION_ORDER,
        ...chart.legend,
        ...Object.values(nextBaseline).flatMap((cell) => Object.keys(cell.allocations)),
      ]),
    ];
    const pending = pendingSavedRef.current;
    if (pending && pending.stackBb === chart.stack_bb && pending.position === chart.position) {
      pendingSavedRef.current = null;
      applySaved(pending);
      return;
    }
    setCells(nextBaseline);
    setActions(nextActions);
    setLocked(new Set());
    setSelected(null);
    setUndoHistory([]);
    setRedoHistory([]);
    setActiveSavedId("");
    setChartName(`${chart.position} ${chart.stack_bb}BB ${chart.mode.replace(/_/g, " ")}`);
  }, [applySaved, chart]);

  useEffect(() => {
    const stopPainting = () => {
      paintingRef.current = false;
    };
    window.addEventListener("pointerup", stopPainting);
    return () => window.removeEventListener("pointerup", stopPainting);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(colors));
  }, [colors]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedCharts));
  }, [savedCharts]);

  const metrics = useMemo(() => scoreStudio(cells, baseline), [cells, baseline]);
  const selectedCell = selected ? cells[selected] : null;
  const presetValue = `${position}|${stackBb}`;

  const pushHistory = () => {
    setUndoHistory((history) => [...history.slice(-39), cells]);
    setRedoHistory([]);
  };

  const paintNotation = (notation: string) => {
    setSelected(notation);
    onHandSelect(notation);
    if (locked.has(notation)) return;
    setCells((current) => ({
      ...current,
      [notation]: {
        ...current[notation],
        allocations: paintedAllocation(activeAction, paintFrequency / 100),
        source: "manual",
      },
    }));
  };

  const startPaint = (notation: string) => {
    pushHistory();
    paintingRef.current = true;
    paintNotation(notation);
  };

  const paintOver = (notation: string, buttons: number) => {
    if (!paintingRef.current || buttons !== 1) return;
    paintNotation(notation);
  };

  const paintCategory = (category: string) => {
    pushHistory();
    const allocation = paintedAllocation(activeAction, paintFrequency / 100);
    setCells((current) =>
      Object.fromEntries(
        Object.entries(current).map(([notation, cell]) => [
          notation,
          isCategory(notation, category) && !locked.has(notation)
            ? { ...cell, allocations: allocation, source: "manual" }
            : cell,
        ]),
      ),
    );
  };

  const undo = () => {
    const previous = undoHistory[undoHistory.length - 1];
    if (!previous) return;
    setRedoHistory((history) => [...history.slice(-39), cells]);
    setCells(previous);
    setUndoHistory((history) => history.slice(0, -1));
  };

  const redo = () => {
    const next = redoHistory[redoHistory.length - 1];
    if (!next) return;
    setUndoHistory((history) => [...history.slice(-39), cells]);
    setCells(next);
    setRedoHistory((history) => history.slice(0, -1));
  };

  const resetToReference = () => {
    pushHistory();
    setCells(baseline);
    setLocked(new Set());
    setSelected(null);
    setMessage("Reset to the current reference chart");
  };

  const toggleSelectedLock = () => {
    if (!selected) return;
    setLocked((current) => {
      const next = new Set(current);
      if (next.has(selected)) next.delete(selected);
      else next.add(selected);
      return next;
    });
  };

  const updateSelectedFrequency = (action: string, value: number) => {
    if (!selected || !selectedCell) return;
    pushHistory();
    setCells((current) => ({
      ...current,
      [selected]: {
        ...current[selected],
        allocations: rebalanceAllocation(current[selected].allocations, action, value, actions),
        source: "manual",
      },
    }));
  };

  const addAction = () => {
    const key = newAction.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!key || actions.includes(key)) return;
    setActions((current) => [...current, key]);
    setColors((current) => ({ ...current, [key]: "#f59e0b" }));
    setActiveAction(key);
    setNewAction("");
  };

  const saveChart = () => {
    if (!chart || !chartName.trim()) return;
    const id = activeSavedId || makeId();
    const saved: SavedStudioChart = {
      version: 1,
      id,
      name: chartName.trim(),
      stackBb,
      position,
      mode: chart.mode,
      referenceSource: chart.source,
      actions,
      colors,
      cells,
      locked: [...locked],
      savedAt: new Date().toISOString(),
    };
    setSavedCharts((current) => {
      const withoutCurrent = current.filter((item) => item.id !== id);
      return [saved, ...withoutCurrent];
    });
    setActiveSavedId(id);
    setMessage(`Saved ${saved.name}`);
  };

  const loadSavedChart = (saved: SavedStudioChart) => {
    if (saved.stackBb === stackBb && saved.position === position) {
      applySaved(saved);
      return;
    }
    pendingSavedRef.current = saved;
    onPositionChange(saved.position);
    onStackChange(saved.stackBb);
    setMessage(`Loading ${saved.name} reference preset…`);
  };

  const exportChart = () => {
    if (!chart) return;
    const portable: SavedStudioChart = {
      version: 1,
      id: activeSavedId || makeId(),
      name: chartName || `${position} ${stackBb}BB chart`,
      stackBb,
      position,
      mode: chart.mode,
      referenceSource: chart.source,
      actions,
      colors,
      cells,
      locked: [...locked],
      savedAt: new Date().toISOString(),
    };
    setPortableText(JSON.stringify(portable, null, 2));
    setMessage("Portable chart JSON generated below");
  };

  const importChart = () => {
    try {
      const parsed: unknown = JSON.parse(portableText);
      if (!validImportedChart(parsed)) throw new Error("Unsupported chart format");
      const imported = { ...parsed, id: makeId(), name: `${parsed.name} (imported)` };
      loadSavedChart(imported);
      setMessage(`Imported ${imported.name}; save it to keep it in your library`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import chart");
    }
  };

  if (!chart && loading) return <p className="muted">Loading range presets…</p>;
  if (!chart) return <p className="muted">Range presets are unavailable.</p>;

  return (
    <div className="range-studio">
      <div className="range-studio-topbar">
        <label className="range-studio-preset">
          Predefined chart
          <select
            value={presetValue}
            onChange={(event) => {
              const [nextPosition, nextDepth] = event.target.value.split("|");
              onPositionChange(nextPosition);
              onStackChange(Number(nextDepth));
            }}
          >
            {positions.flatMap((presetPosition) =>
              depths.map((depth) => (
                <option key={`${presetPosition}-${depth}`} value={`${presetPosition}|${depth}`}>
                  {presetPosition} · {depth}BB · {presetMode(depth)}
                </option>
              )),
            )}
          </select>
        </label>
        <div className="range-studio-provenance">
          <span className="source-chip reference">Reference: {chart.source}</span>
          <span className="source-chip">{chart.mode.replace(/_/g, " ")}</span>
          <span className="source-chip manual">{metrics.overrides} manual cells</span>
        </div>
        <div className="range-studio-history">
          <button type="button" className="ghost-btn small" onClick={undo} disabled={!undoHistory.length}>
            Undo
          </button>
          <button type="button" className="ghost-btn small" onClick={redo} disabled={!redoHistory.length}>
            Redo
          </button>
          <button type="button" className="ghost-btn small" onClick={resetToReference}>
            Reset
          </button>
        </div>
      </div>

      {loading ? <div className="range-studio-loading">Refreshing reference preset…</div> : null}

      <div className="range-studio-layout">
        <div className="range-studio-canvas">
          <div className="range-studio-palette" aria-label="Paint action">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                className={`paint-action${activeAction === action ? " active" : ""}`}
                onClick={() => setActiveAction(action)}
              >
                <span className="paint-action-color" style={{ background: colors[action] ?? DEFAULT_COLORS.fold }} />
                {labelAction(action)}
              </button>
            ))}
          </div>

          <RangeGrid
            cells={cells}
            baseline={baseline}
            actions={actions}
            colors={colors}
            selected={selected}
            locked={locked}
            onStartPaint={startPaint}
            onPaintOver={paintOver}
          />

          <div className="range-studio-categories">
            <span>Paint category</span>
            {[
              ["all", "All"],
              ["pairs", "Pairs"],
              ["suited", "Suited"],
              ["offsuit", "Offsuit"],
              ["broadway", "Broadway"],
            ].map(([key, label]) => (
              <button key={key} type="button" className="ghost-btn small" onClick={() => paintCategory(key)}>
                {label}
              </button>
            ))}
          </div>

          <div className="range-studio-score-grid">
            <div className="range-score-card">
              <span>Frequency match</span>
              <strong>{metrics.score.toFixed(1)}%</strong>
            </div>
            <div className="range-score-card">
              <span>Avg frequency difference</span>
              <strong>{metrics.averageDifference.toFixed(1)}%</strong>
            </div>
            <div className="range-score-card">
              <span>Exact cells</span>
              <strong>{metrics.exact} / {Object.keys(baseline).length}</strong>
            </div>
            <div className="range-score-card">
              <span>CFR+ exploitability</span>
              <strong>{chart.cfr.exploitability?.toFixed(4) ?? "—"}</strong>
            </div>
          </div>
          <p className="muted small">
            Frequency match compares this chart with the loaded reference. It is not EV loss or a full GTO score.
          </p>
        </div>

        <aside className="range-studio-tools">
          <section className="range-tool-section">
            <h4>Paint</h4>
            <label>
              {labelAction(activeAction)} frequency
              <div className="frequency-control">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={paintFrequency}
                  onChange={(event) => setPaintFrequency(Number(event.target.value))}
                />
                <input
                  className="frequency-number"
                  type="number"
                  min={0}
                  max={100}
                  value={paintFrequency}
                  onChange={(event) => setPaintFrequency(Math.min(100, Math.max(0, Number(event.target.value))))}
                />
                <span>%</span>
              </div>
            </label>
            <p className="muted small">Click or drag across cells. The remaining frequency is assigned to fold.</p>
            <div className="add-action-row">
              <input
                value={newAction}
                onChange={(event) => setNewAction(event.target.value)}
                placeholder="Add action / size"
              />
              <button type="button" className="ghost-btn small" onClick={addAction}>Add</button>
            </div>
          </section>

          <section className="range-tool-section">
            <h4>Selected hand</h4>
            {selectedCell ? (
              <>
                <div className="selected-hand-title">
                  <strong>{selectedCell.notation}</strong>
                  <button type="button" className="ghost-btn small" onClick={toggleSelectedLock}>
                    {locked.has(selectedCell.notation) ? "Unlock" : "Lock"}
                  </button>
                </div>
                {actions.map((action) => (
                  <label key={action} className="cell-frequency-row">
                    <span>
                      <i style={{ background: colors[action] ?? DEFAULT_COLORS.fold }} />
                      {labelAction(action)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round((selectedCell.allocations[action] ?? 0) * 100)}
                      onChange={(event) => updateSelectedFrequency(action, Number(event.target.value) / 100)}
                    />
                    <b>{Math.round((selectedCell.allocations[action] ?? 0) * 100)}%</b>
                  </label>
                ))}
                <p className="muted small">
                  Source: {selectedCell.source}
                  {selectedCell.nnValuePct != null ? ` · neural value ${selectedCell.nnValuePct.toFixed(0)}%` : ""}
                </p>
              </>
            ) : (
              <p className="muted small">Select a grid cell to edit its mixed strategy.</p>
            )}
          </section>

          <details className="range-tool-section" open>
            <summary>Action colors</summary>
            <label>
              Theme
              <select
                defaultValue="Classic"
                onChange={(event) => setColors((current) => ({ ...current, ...COLOR_THEMES[event.target.value] }))}
              >
                {Object.keys(COLOR_THEMES).map((theme) => <option key={theme}>{theme}</option>)}
              </select>
            </label>
            <div className="color-editor-grid">
              {actions.map((action) => (
                <label key={action}>
                  <input
                    type="color"
                    value={colors[action] ?? DEFAULT_COLORS.fold}
                    onChange={(event) => setColors((current) => ({ ...current, [action]: event.target.value }))}
                  />
                  {labelAction(action)}
                </label>
              ))}
            </div>
          </details>

          <section className="range-tool-section">
            <h4>Chart library</h4>
            <input value={chartName} onChange={(event) => setChartName(event.target.value)} placeholder="Chart name" />
            <div className="btn-row">
              <button type="button" className="primary-btn" onClick={saveChart}>Save chart</button>
              <button type="button" className="ghost-btn" onClick={exportChart}>Export</button>
            </div>
            <select
              value={activeSavedId}
              onChange={(event) => {
                const saved = savedCharts.find((item) => item.id === event.target.value);
                if (saved) loadSavedChart(saved);
              }}
            >
              <option value="">Saved charts…</option>
              {savedCharts.map((saved) => (
                <option key={saved.id} value={saved.id}>
                  {saved.name} · {saved.position} {saved.stackBb}BB
                </option>
              ))}
            </select>
            <details className="portable-chart">
              <summary>Portable JSON</summary>
              <textarea
                value={portableText}
                onChange={(event) => setPortableText(event.target.value)}
                placeholder="Export a chart or paste LeakSnipe Range Studio JSON"
              />
              <div className="btn-row">
                <button type="button" className="ghost-btn small" onClick={exportChart}>Generate</button>
                <button type="button" className="ghost-btn small" onClick={importChart}>Import</button>
              </div>
            </details>
            {message ? <p className="range-studio-message">{message}</p> : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
