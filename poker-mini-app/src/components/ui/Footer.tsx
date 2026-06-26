import React from "react";
import { Tab } from "~/lib/tabs";

interface FooterProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  showWallet?: boolean;
}

const NAV_ITEMS: { tab: Tab; icon: string; label: string }[] = [
  { tab: Tab.Home, icon: "🏠", label: "Home" },
  { tab: Tab.Dashboard, icon: "📊", label: "Dashboard" },
  { tab: Tab.HandAnalysis, icon: "🔬", label: "Hands" },
  { tab: Tab.Leaderboards, icon: "🏆", label: "Ranks" },
  { tab: Tab.Analytics, icon: "📈", label: "Stats" },
];

export const Footer: React.FC<FooterProps> = ({ activeTab, setActiveTab, showWallet = false }) => (
  <div className="glass-panel fixed bottom-0 left-0 right-0 mx-4 mb-4 px-1 py-2 z-50">
    <div className="flex justify-around items-center h-14">
      {NAV_ITEMS.map(({ tab, icon, label }) => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
            activeTab === tab ? 'text-primary-light drop-shadow-[0_0_6px_rgba(34,211,238,0.6)]' : 'text-gray-500'
          }`}
        >
          <span className="text-lg">{icon}</span>
          <span className="text-[10px] mt-1">{label}</span>
        </button>
      ))}
      {showWallet && (
        <button
          onClick={() => setActiveTab(Tab.Wallet)}
          className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
            activeTab === Tab.Wallet ? 'text-primary-light drop-shadow-[0_0_6px_rgba(34,211,238,0.6)]' : 'text-gray-500'
          }`}
        >
          <span className="text-lg">👛</span>
          <span className="text-[10px] mt-1">Wallet</span>
        </button>
      )}
    </div>
  </div>
);
