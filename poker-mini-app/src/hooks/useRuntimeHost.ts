"use client";

import { useEffect, useState } from "react";
import type { RuntimeHost } from "~/types/universal";

function detectRuntimeHost(): RuntimeHost {
  if (typeof window === "undefined") return "unknown_browser";

  const ua = window.navigator.userAgent.toLowerCase();
  const isIOS =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /android/.test(ua);
  const isSafari = /safari/.test(ua) && !/chrome|crios|fxios|android/.test(ua);
  const isChrome = /chrome|crios/.test(ua);

  const farcasterLikely =
    ua.includes("farcaster") ||
    ua.includes("warpcast") ||
    (() => {
      try {
        return window.location !== window.parent.location;
      } catch {
        return true; // cross-origin parent access throws when embedded in a Farcaster client frame
      }
    })();

  if (farcasterLikely) return "farcaster";
  if (isIOS && isSafari) return "ios_safari";
  if (isAndroid && isChrome) return "android_chrome";
  if (!isIOS && !isAndroid) return "desktop_browser";

  return "unknown_browser";
}

export function useRuntimeHost(): RuntimeHost {
  const [runtimeHost, setRuntimeHost] = useState<RuntimeHost>("unknown_browser");

  useEffect(() => {
    setRuntimeHost(detectRuntimeHost());
  }, []);

  return runtimeHost;
}
