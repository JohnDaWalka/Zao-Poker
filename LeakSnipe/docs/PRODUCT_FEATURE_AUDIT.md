# LeakSnipe product feature audit

Research date: 2026-06-19

## Product direction

LeakSnipe should connect four workflows instead of cloning isolated screens:

1. **Track** hands and expose reliable situational statistics.
2. **Find** costly or repeated decisions with filters and reports.
3. **Study** the matching range, board class, and decision tree.
4. **Drill** the exact spot and measure improvement over time.

The highest-value pattern across PokerTracker 4, Holdem Manager 3, Hand2Note 4,
and GTO Wizard is this report-to-hand-to-study-to-drill loop.

## Competitive findings

### PokerTracker 4

- Deep report filters, saved quick filters, interactive drill-down, custom reports,
  hand-range heatmaps, and scatter/luck/money-flow graphs.
- Custom HUD statistics and street-by-street popups.
- Hand tagging, automated notes, replayer-integrated equity and ICM tools.
- LeakTracker compares statistics with winning-player samples.

Source: <https://www.pokertracker.com/products/PT4/>

### Holdem Manager 3

- Thousands of tracked statistics, custom HUDs, popup drill-down, and more than 25
  default post-game reports.
- Situational dashboards for c-betting, 3-betting, river play, and tournament all-ins.
- Visual AND/OR filters, session monitoring, marked hands, and replay with stats as
  they appeared at the time of play.

Source: <https://www.holdemmanager.com/>

### Hand2Note 4

- Dynamic and positional HUDs that change with current actions.
- Fast reports over large databases, player-pool segmentation, range research,
  negative-EV spot discovery, custom stats, and smart reports.
- Reports, popups, and replayer optimized for very large data sets.

Source: <https://hand2note.com/>

### GTO Wizard

GTO Wizard's core advantage is workflow integration, not any single chart.

#### Range Builder

- Select solution, line, board/texture, and difficulty/action grouping.
- Paint hands, exact combos, or hand/draw categories with an action and frequency.
- Use sliders, arrows, presets, or manual frequency entry.
- Pin hands, lock combos, include/exclude suits, and switch normalized/horizontal views.
- Show opponent range, reveal reference frequencies, use focus mode, undo/redo/clear.
- Grade every combo against the reference, regroup actions after submission, compare
  hands/draws/equity buckets, identify best/worst categories, and export Pio/GTO+ text.

Source: <https://help.gtowizard.com/how-to-use-the-range-builder/>

#### Study

- Strategy, ranges, breakdown, and aggregate-report views.
- Color-mixed strategy matrix with combo detail.
- Strategy, EV, equity, EQR, range weight, blocker, and action-comparison views.
- Hand-class, draw, equity-bucket, suit, and action filters.
- Side-by-side range comparison and equity-distribution graphs.
- Custom action colors through preset or user themes.

Sources:

- <https://help.gtowizard.com/study-mode/>
- <https://help.gtowizard.com/ranges-tab/>
- <https://help.gtowizard.com/breakdown-tab/>

#### Aggregate reports

- Weighted reports over all 1,755 strategically distinct flops.
- Strategy/EV/EQ/EQR views, chart/table modes, action grouping, saved filters,
  board-texture grouping, conditional highlighting, and turn-card reports.
- Direct jumps from a report to its solution or practice drill.

Source: <https://help.gtowizard.com/aggregate-reports-guide/>

#### Analyzer and practice

- Action-line filters, saved reports, adjustable columns/density, bulk notes, and
  one-click jumps from a reviewed hand to Study or Practice.
- GTO score, EV loss, pot-relative EV loss, frequency difference, mistake severity,
  practiced-hand/session history, and per-drill stats.
- Full-hand, street, and single-spot drills; hand/board filters; close-decision mode;
  RNG-aware mixing; saved/tagged/shareable drills.

Sources:

- <https://help.gtowizard.com/how-to-use-the-hand-history-analyzer/>
- <https://blog.gtowizard.com/redesigned_analyzer_and_upgraded_gto_reports/>
- <https://help.gtowizard.com/how-to-use-the-trainer/>
- <https://help.gtowizard.com/manage-training-drills/>
- <https://help.gtowizard.com/measure-performance/>

#### Custom solving

- Editable ranges, stacks, pot, rake, antes, ICM, player count, betting tree, and
  fixed/dynamic/automatic sizing.
- Saved/tagged ranges, trees, parameters, solutions, and import/export.
- Current multiway preflop setup includes as many as nine players.

Source: <https://help.gtowizard.com/how-to-build-custom-solutions/>

## Current LeakSnipe gap analysis

### Already present

- Local hand-history import and database.
- Original Python live HUD and positional opponent statistics.
- Hand detail, action log, replay, AI coach, tagging data model, and Monte Carlo equity.
- CFR+ toy subgames, depth charts, a 13x13 range matrix, and neural-value experiments.
- Tournament antes in theory inputs and required stack depths.

### Missing or incomplete

- Hands list has no board column or serious filtering/report system.
- Tags exist in the database but do not form a complete review workflow.
- Stats are broad aggregates rather than situational reports with drill-down hands.
- Theory chart is read-only; no painter, mixed-frequency cells, combo editing, locks,
  suit/category filters, saved custom charts, import/export, or color themes.
- No practice/drill mode, drill history, saved drills, or progress tracking.
- Replayer does not show solver action frequencies or action EV at each covered node.
- Existing CFR+ games and chart approximations cannot support a truthful universal
  GTO score or full-hand EV-loss metric.

## Recommended implementation sequence

### Phase 1: Range Studio

Build this first because the existing chart endpoint can supply honest presets.

- Preset browser: position, stack, scenario, table size, antes, and source metadata.
- Editable 13x13 grid with click/drag painting.
- Multiple actions per cell with frequency normalization and split-color rendering.
- Exact-combo editor, suit filters, category selection, pin/lock, undo/redo/clear.
- Custom per-action colors and named themes.
- Reset/compare against the CFR+ preset.
- Save/load custom charts locally; tag and duplicate charts.
- Import/export common range text formats.
- Clearly label each cell as `cfr_plus`, `approximation`, or `manual`.

Do not label frequency-distance scoring as EV loss. A preset comparison can report
frequency difference and exact-match accuracy until a decision has real EV values.

### Phase 2: Analyzer and report foundation

- Include board cards in hand summaries and display them in the Hands table.
- Database-backed filters for dates, site, position, stack depth, result, pot, board,
  hole cards, tags, street reached, pot type, and action sequence.
- Sortable/pinnable columns, adjustable density, saved reports, and bulk tags.
- Situational dashboards for RFI, faced RFI, 3-bet, c-bet, fold-to-c-bet, turn barrels,
  river decisions, and all-ins.
- Every metric must show numerator, denominator, and sample-size warning.
- Clicking a report cell opens the exact contributing hands.

### Phase 3: Review-to-study bridge

- From a hand/action, open the nearest covered Theory preset with the actual stack,
  positions, antes, board, and action line.
- Show coverage status and any size/stack mismatch explicitly.
- Add strategy frequencies in the replayer for covered nodes.
- Compute action EV and EV loss only where the solver/reference supplies actual EV.

### Phase 4: Practice and progress

- Generate drills from Range Studio presets and reviewed hands.
- Single-decision and street drills before attempting full-hand simulation.
- Frequency mode, optional RNG, close-decision filtering, and mistake pause.
- Saved/tagged drills, sessions, practiced-hand replay, and progress by scenario.
- Score frequency accuracy everywhere; score EV loss only on EV-covered decisions.

### Phase 5: Board-texture reports and solver expansion

- Deterministic board classifier: pairing, suit texture, connectivity, high card,
  straight/flush completion, and draw families.
- Weighted flop/turn reports based on actual combo/runout probability.
- Expand CFR abstraction and test exploitability before broadening solver claims.
- Keep Monte Carlo equity, CFR strategy, approximated charts, and AI explanations as
  separate provenance types throughout the API and UI.

## Non-negotiable accuracy rules

- Never derive EV loss, GTO score, or action frequencies from an LLM.
- Never call scaled reference ranges a full GTO solution.
- Show solver coverage, abstraction, iterations, exploitability, and input mismatch.
- Preserve actual tournament antes, effective stacks, table size, and action order.
- AI can explain computed results but must not manufacture them.
