# Introducing LeakSnipe

LeakSnipe is a local-first poker study workstation built around a simple idea: a hand tracker is most useful when it connects the hand you played to the reason it mattered and the next thing you should study.

Most poker workflows are fragmented. Hand histories live in one tool, opponent statistics in another, equity calculations in a browser, range charts in screenshots, and session notes in a separate document. LeakSnipe brings those workflows into one Windows desktop application while keeping the hand database and poker math on the local machine.

## The core workflow

LeakSnipe is organized around five connected steps:

1. **Track** — import hands automatically and preserve the full action history.
2. **Find** — surface positional tendencies, leaks, unusual results, and marked decisions.
3. **Review** — inspect board cards, actions, opponent statistics, and the complete replay.
4. **Study** — calculate equity, inspect a stack chart, edit a range, or run a covered theory experiment.
5. **Improve** — use grounded coaching to explain the decision and eventually turn repeated mistakes into drills.

The goal is not to reproduce every screen from an established tracker or solver. The goal is to make the path between a real hand and useful study shorter, clearer, and more honest.

## Who it is for

LeakSnipe is currently aimed at serious tournament players who:

- play on Windows poker clients using text hand histories
- want a private, searchable local hand database
- need opponent statistics broken down by position
- review hands street by street rather than accepting a one-paragraph summary
- want equity and pot odds computed by code instead of guessed by a language model
- use stack-depth ranges and want to customize, color, and compare them
- want AI coaching but still care where every number came from

BetACR/ACR tournament workflows receive the most development and live-HUD attention today, although the parser and settings model include additional site support.

## What makes it different

### Local data is the source of truth

Hands, actions, players, tags, statistics, and coach memory are stored locally. LeakSnipe does not require a hosted database or subscription service to browse a session, replay a hand, or calculate equity.

### Poker math stays separate from AI prose

LeakSnipe's equity engine handles Hold'em, Omaha Hi-Lo, seven-card stud, and stud hi-lo through Monte Carlo simulation. The AI coach may explain those results, but it must not invent or replace them.

### Statistics retain their denominator

An opponent's “BTN VPIP 36%” is useful only when the sample size is visible. LeakSnipe persists per-hand positional facts, aggregates them efficiently, and keeps the contributing hand count beside the percentage.

### Theory claims have boundaries

LeakSnipe includes CFR+ and neural-value experiments, but it does not present a toy or abstracted game as a full no-limit hold'em solution. Charts and outputs should state whether they came from exact computation, CFR+, an approximation, or manual editing.

### The original HUD remains a first-class component

The production live HUD uses the mature Python/pywin32 overlay. Tauri owns the main application shell, but LeakSnipe does not discard a working native overlay merely to force every feature into one technology.

## A quick tour

### Hands

The Hands view is the operational center. It shows recent hands and board cards, exposes opponent statistics without opening a separate screen, and provides deliberate access to the hand replayer. Single-click inspection and double-click replay are kept distinct to avoid interrupting fast review.

### Stats

The Stats view summarizes volume, outcomes, positions, and detected leaks. The long-term direction is deeper situational reporting where every statistic can drill down into the exact hands that produced it.

### AI Coach

The coach supports hand analysis, session review, chat, memory, and optional research. ASI:One is the preferred provider when configured, with other cloud providers and local Ollama available as alternatives. Web access is off or on-demand by default rather than silently attached to every request.

### Equity

The Equity view is a local calculator, not an LLM prompt. It supports multiple poker variants and provides the computed grounding used by coaching features.

### Theory and Range Studio

The Theory area combines small-game CFR+, neural-value experiments, stack-depth charts, and an editable Range Studio. Users can start from a predefined chart, paint mixed frequencies, customize action colors, compare against the reference, and save manual work locally.

### Settings and diagnostics

Settings controls hero identities, hand-history folders, AI routing, web-search policy, HUD layout, and runtime diagnostics. The diagnostics surface exposes the active process, local database, migration version, fact counts, and log locations without exposing API keys.

## Product principles

LeakSnipe development follows a few non-negotiable rules:

1. **Do not invent poker numbers.** Equity, pot odds, EV, frequencies, and statistics require a real computation or source.
2. **Show provenance.** Users should know whether output is parsed, calculated, solved, approximated, manually edited, or AI-explained.
3. **Preserve context.** Antes, stack depth, table size, position, board, and action order matter.
4. **Prefer local correctness.** A reliable SQLite workflow is more valuable than premature distributed infrastructure.
5. **Keep graceful fallbacks.** The Python GUI and HUD remain supported while the Tauri application evolves.
6. **Make research explicit.** Web requests should happen because the user requested current external information.

## Current boundaries

LeakSnipe is not currently:

- a full commercial-grade no-limit hold'em solver
- a universal real-time assistance system
- a hosted multi-user service
- a replacement for understanding a poker site's rules
- a guarantee that every supported parser has equal depth

It is an actively developed personal analysis platform with a strong local engine, an increasingly cohesive desktop workflow, and an explicit roadmap toward report-driven study and practice.

## Where the project is going

The next major product loop is:

> **Report → Contributing hands → Replay → Matching range/spot → Practice drill → Progress**

That requires deeper filters, situational dashboards, saved reports, review-to-study linking, drill history, and broader solver coverage with honest abstraction labels. The detailed sequence is maintained in [PRODUCT_FEATURE_AUDIT.md](PRODUCT_FEATURE_AUDIT.md).

## Continue reading

- Return to the [main README](../README.md) for installation and development instructions.
- Read [THEORY.md](THEORY.md) for solver and neural-value details.
- Read [PRODUCT_FEATURE_AUDIT.md](PRODUCT_FEATURE_AUDIT.md) for competitive research and roadmap priorities.
