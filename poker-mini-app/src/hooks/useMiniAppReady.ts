"use client";

import { useEffect } from "react";
import { sdk } from "@farcaster/miniapp-sdk";

export function useMiniAppReady() {
  useEffect(() => {
    async function ready() {
      try {
        await sdk.actions.ready();
      } catch {
        // Outside Farcaster/Warpcast there is no mini-app host to notify.
      }
    }

    void ready();
  }, []);
}
