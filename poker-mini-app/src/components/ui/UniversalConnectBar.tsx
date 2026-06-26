"use client";

import { useUniversalUser } from "~/hooks/useUniversalUser";

function labelForRuntimeHost(runtimeHost: ReturnType<typeof useUniversalUser>["runtimeHost"]) {
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

export function UniversalConnectBar() {
  const user = useUniversalUser();

  return (
    <div className="glass-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-primary-light">
            {user.displayName}
          </span>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-light">
            {user.authSource}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
          <span>{labelForRuntimeHost(user.runtimeHost)}</span>
          {user.walletAddress && (
            <span>
              {user.walletAddress.slice(0, 6)}…{user.walletAddress.slice(-4)}
            </span>
          )}
          {user.chainNamespace && (
            <span className="uppercase">{user.chainNamespace}</span>
          )}
        </div>
      </div>
      <div className="text-[11px] text-gray-500 sm:text-right">
        Universal runtime active
      </div>
    </div>
  );
}
