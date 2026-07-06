"use client";

import { useState } from "react";
import { APP_NAME } from "~/lib/constants";
import { sdk } from "@farcaster/miniapp-sdk";
import { useMiniApp } from "@neynar/react";
import { useUniversalUser } from "~/hooks/useUniversalUser";
import { ConnectWallet } from "~/components/ui/wallet/ConnectWallet";
import { PrivyLoginButton } from "~/components/ui/wallet/PrivyLoginButton";
import { getPublicEnv } from "~/lib/env";

const { privyAppId } = getPublicEnv();

type HeaderProps = {
  neynarUser?: {
    fid: number;
    score: number;
  } | null;
};

export function Header({ neynarUser }: HeaderProps) {
  const { context } = useMiniApp();
  const universalUser = useUniversalUser();
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);

  return (
    <div className="relative">
      <div className="glass-panel mt-4 mb-4 mx-4 px-3 py-2 flex items-center justify-between">
        <div className="text-lg font-semibold tracking-wide text-primary-light drop-shadow-[0_0_6px_rgba(34,211,238,0.5)]">
          {APP_NAME}
        </div>
        {/* Outside Farcaster, surface wallet connect / guest identity instead
            of the Farcaster profile dropdown below. */}
        {universalUser.authSource !== "farcaster" && (
          <div className="flex items-center gap-2">
            {privyAppId && <PrivyLoginButton />}
            <ConnectWallet />
          </div>
        )}
        {context?.user && (
          <div 
            className="cursor-pointer"
            onClick={() => {
              setIsUserDropdownOpen(!isUserDropdownOpen);
            }}
          >
            {context.user.pfpUrl && (
              <img
                src={context.user.pfpUrl}
                alt="Profile"
                className="w-10 h-10 rounded-full border-2 border-primary shadow-glow"
              />
            )}
          </div>
        )}
      </div>
      {context?.user && (
        <>      
          {isUserDropdownOpen && (
            <div className="glass-panel absolute top-full right-0 z-50 w-fit mt-1 mx-4">
              <div className="p-3 space-y-2">
                <div className="text-right">
                  <h3
                    className="font-bold text-sm text-primary-light hover:underline cursor-pointer inline-block"
                    onClick={() => sdk.actions.viewProfile({ fid: context.user.fid })}
                  >
                    {context.user.displayName || context.user.username}
                  </h3>
                  <p className="text-xs text-gray-400">
                    @{context.user.username}
                  </p>
                  <p className="text-xs text-gray-500">
                    FID: {context.user.fid}
                  </p>
                  {neynarUser && (
                    <>
                      <p className="text-xs text-gray-500">
                        Neynar Score: {neynarUser.score}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
