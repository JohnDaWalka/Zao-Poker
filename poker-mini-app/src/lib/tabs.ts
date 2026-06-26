/**
 * Tab identifiers for the main app navigation.
 *
 * Lives in its own leaf module (no imports) so both the App container and the
 * Footer can import it without creating a circular dependency. Previously this
 * enum lived in `~/components/App`, which imports `Footer`, while `Footer`
 * imported the enum back from `~/components/App` — at module-evaluation time the
 * enum was still undefined, so `Tab.Home` threw and the whole app blanked.
 */
export enum Tab {
  Home = "home",
  Dashboard = "dashboard",
  HandAnalysis = "hand-analysis",
  Leaderboards = "leaderboards",
  Analytics = "analytics",
  Wallet = "wallet",
}
