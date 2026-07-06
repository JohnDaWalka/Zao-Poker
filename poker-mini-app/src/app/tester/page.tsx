"use client";

import { useEffect, useState } from "react";
import { useMiniApp } from "@neynar/react";
import { sdk } from "@farcaster/miniapp-sdk";
import { useRuntimeHost } from "~/hooks/useRuntimeHost";
import Link from "next/link";
import {
  vetUserByFid,
  type UserVettingResult,
  TIER_COLORS,
  TIER_LABELS,
  TIER_DESCRIPTIONS,
  DEFAULT_THRESHOLDS,
  STRICT_THRESHOLDS,
} from "~/lib/user-vetting";

type CheckStatus = "loading" | "ok" | "error" | "skipped";

interface CheckResult {
  name: string;
  status: CheckStatus;
  message?: string;
  detail?: string;
}

function StatusDot({ status }: { status: CheckStatus }) {
  const colors = {
    loading: "bg-yellow-400 animate-pulse",
    ok: "bg-green-500",
    error: "bg-red-500",
    skipped: "bg-gray-400",
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full mr-2 ${colors[status]}`} />
  );
}

export default function TesterPage() {
  const { context, isSDKLoaded } = useMiniApp();
  const runtimeHost = useRuntimeHost();
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [publicUrl, setPublicUrl] = useState<string>("");
  const [copyStatus, setCopyStatus] = useState<string>("");
  const [neynarUser, setNeynarUser] = useState<any>(null);
  const [neynarLoading, setNeynarLoading] = useState(false);
  const [fidInput, setFidInput] = useState<string>("");
  const [vettingResult, setVettingResult] = useState<UserVettingResult | null>(null);
  const [vettingLoading, setVettingLoading] = useState(false);

  useEffect(() => {
    async function runChecks() {
      const results: CheckResult[] = [];

      // 1. SDK Load Check
      results.push({
        name: "Mini App SDK Loaded",
        status: isSDKLoaded ? "ok" : "error",
        message: isSDKLoaded ? "SDK is ready" : "SDK not loaded — running outside Farcaster host",
      });

      // 2. Context Check
      results.push({
        name: "Farcaster Context",
        status: context ? "ok" : "error",
        message: context ? `User FID: ${context.user?.fid}` : "No context — not in a Farcaster client",
      });

      // 3. Runtime Host
      results.push({
        name: "Runtime Host Detection",
        status: "ok",
        message: `Detected: ${runtimeHost}`,
      });

      // 4. API Connectivity
      try {
        const res = await fetch("/api/table", { cache: "no-store" });
        results.push({
          name: "API Table Route",
          status: res.ok ? "ok" : "error",
          message: res.ok ? "API responding" : `API returned ${res.status}`,
        });
      } catch (e) {
        results.push({
          name: "API Table Route",
          status: "error",
          message: `API unreachable: ${e}`,
        });
      }

      // 5. Farcaster Manifest
      try {
        const res = await fetch("/.well-known/farcaster.json", { cache: "no-store" });
        const data = await res.json();
        results.push({
          name: "Farcaster Manifest",
          status: res.ok ? "ok" : "error",
          message: res.ok ? "Manifest valid" : `Manifest error: ${res.status}`,
          detail: res.ok ? JSON.stringify(data, null, 2).slice(0, 300) : undefined,
        });
      } catch (e) {
        results.push({
          name: "Farcaster Manifest",
          status: "error",
          message: `Manifest fetch failed: ${e}`,
        });
      }

      // 6. Neynar API Check
      try {
        const res = await fetch("/api/users/score?fids=1", { cache: "no-store" });
        results.push({
          name: "Neynar API",
          status: res.ok ? "ok" : "error",
          message: res.ok ? "Neynar API reachable" : `Neynar API returned ${res.status}`,
        });
      } catch (e) {
        results.push({
          name: "Neynar API",
          status: "error",
          message: `Neynar API unreachable: ${e}`,
        });
      }

      // 7. Environment
      const envVars = {
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXT_PUBLIC_URL: (typeof window !== "undefined" ? window.location.origin : undefined),
      };
      results.push({
        name: "Environment",
        status: "ok",
        message: `App URL: ${envVars.NEXT_PUBLIC_URL || envVars.NEXT_PUBLIC_APP_URL || "not set"}`,
      });

      setChecks(results);

      // Auto-fetch Neynar user and vetting if context is available
      if (context?.user?.fid) {
        await fetchNeynarUser(context.user.fid.toString());
        await fetchVetting(context.user.fid);
      }
    }

    runChecks();
  }, [isSDKLoaded, context, runtimeHost]);

  const fetchVetting = async (fid: number) => {
    setVettingLoading(true);
    try {
      const result = await vetUserByFid(fid, DEFAULT_THRESHOLDS);
      setVettingResult(result);
    } catch (e) {
      setVettingResult(null);
    } finally {
      setVettingLoading(false);
    }
  };

  const fetchNeynarUser = async (fid: string) => {
    setNeynarLoading(true);
    setVettingLoading(true);
    try {
      const res = await fetch(`/api/users/score?fids=${fid}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setNeynarUser(data.users?.[0] || null);
        // Also fetch vetting
        await fetchVetting(parseInt(fid));
      } else {
        setNeynarUser(null);
        setVettingResult(null);
      }
    } catch (e) {
      setNeynarUser(null);
      setVettingResult(null);
    } finally {
      setNeynarLoading(false);
      setVettingLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopyStatus("Copied!");
      setTimeout(() => setCopyStatus(""), 2000);
    });
  };

  const allOk = checks.length > 0 && checks.every((c) => c.status === "ok" || c.status === "skipped");
  const anyError = checks.some((c) => c.status === "error");

  return (
    <div className="min-h-screen bg-[#02060b] text-white p-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">ZAO Poker — Mini App Tester</h1>
        <div className="bg-purple-900/30 border border-purple-700 rounded-lg p-3 mb-6 text-sm">
          <p className="text-purple-200">
            <strong>Ecosystem Update (Jan 2026):</strong> Neynar now operates Farcaster, Warpcast, and Clanker. 
            The protocol remains open-source and permissionless. 
            <a href="https://www.theblock.co/post/386549/haun-backed-neynar-acquires-farcaster-after-founders-pivot-to-wallet-app" target="_blank" rel="noopener noreferrer" className="text-purple-300 underline hover:text-purple-100 ml-1">Read more →</a>
          </p>
        </div>

        {/* Health Summary */}
        <div className={`p-4 rounded-lg mb-6 ${allOk ? "bg-green-900/30 border border-green-700" : anyError ? "bg-red-900/30 border border-red-700" : "bg-yellow-900/30 border border-yellow-700"}`}>
          <div className="flex items-center">
            <StatusDot status={allOk ? "ok" : anyError ? "error" : "loading"} />
            <span className="font-semibold">
              {allOk ? "All checks passed — ready for Farcaster preview" : anyError ? "Some checks failed — see below" : "Running checks..."}
            </span>
          </div>
        </div>

        {/* Checks */}
        <div className="space-y-3 mb-8">
          <h2 className="text-lg font-semibold text-gray-300">System Checks</h2>
          {checks.map((check) => (
            <div key={check.name} className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
              <div className="flex items-center">
                <StatusDot status={check.status} />
                <span className="font-medium">{check.name}</span>
              </div>
              {check.message && (
                <p className="text-sm text-gray-400 mt-1 ml-4">{check.message}</p>
              )}
              {check.detail && (
                <pre className="text-xs text-gray-500 mt-2 ml-4 bg-gray-800 p-2 rounded overflow-x-auto">
                  {check.detail}
                </pre>
              )}
            </div>
          ))}
        </div>

        {/* Context Inspector */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-300 mb-2">Farcaster Context Inspector</h2>
          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
            <pre className="font-mono text-xs whitespace-pre-wrap break-words text-green-400">
              {JSON.stringify(context, null, 2) || "No context available — run inside Farcaster client"}
            </pre>
          </div>
        </div>

        {/* SDK Actions Test */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-300 mb-2">SDK Actions Test</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={async () => {
                try {
                  await sdk.actions.ready();
                  alert("sdk.actions.ready() succeeded");
                } catch (e) {
                  alert(`sdk.actions.ready() failed: ${e}`);
                }
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded-lg text-sm font-medium transition"
            >
              Test ready()
            </button>
            <button
              onClick={async () => {
                try {
                  await sdk.actions.openUrl("https://farcaster.xyz");
                } catch (e) {
                  alert(`openUrl failed: ${e}`);
                }
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded-lg text-sm font-medium transition"
            >
              Test openUrl()
            </button>
            <button
              onClick={async () => {
                try {
                  await sdk.actions.viewProfile({ fid: context?.user?.fid ?? 1 });
                } catch (e) {
                  alert(`viewProfile failed: ${e}`);
                }
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white py-2 px-4 rounded-lg text-sm font-medium transition"
            >
              Test viewProfile()
            </button>
            <button
              onClick={() => {
                alert(`Runtime: ${runtimeHost}\nSDK Loaded: ${isSDKLoaded}\nUser Agent: ${navigator.userAgent}`);
              }}
              className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded-lg text-sm font-medium transition"
            >
              Show Runtime Info
            </button>
          </div>
        </div>

        {/* Neynar API User Lookup */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-300 mb-2">Neynar API User Lookup</h2>
          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={fidInput}
                onChange={(e) => setFidInput(e.target.value)}
                placeholder="Enter FID (e.g. 2272296)"
                className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500"
              />
              <button
                onClick={() => fidInput && fetchNeynarUser(fidInput)}
                className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
              >
                Lookup
              </button>
            </div>
            {neynarLoading && <p className="text-sm text-gray-400">Loading...</p>}
            {neynarUser && (
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-3 mb-2">
                  {neynarUser.pfp_url && (
                    <img src={neynarUser.pfp_url} alt="" className="w-10 h-10 rounded-full" />
                  )}
                  <div>
                    <p className="font-semibold text-white">{neynarUser.display_name || neynarUser.username}</p>
                    <p className="text-sm text-gray-400">@{neynarUser.username} · FID {neynarUser.fid}</p>
                  </div>
                </div>
                <pre className="text-xs text-gray-500 bg-gray-900 p-2 rounded overflow-x-auto">
                  {JSON.stringify(neynarUser, null, 2)}
                </pre>
              </div>
            )}
            {!neynarUser && !neynarLoading && (
              <p className="text-sm text-gray-500">Enter a FID to look up user data via Neynar API</p>
            )}
          </div>
        </div>

        {/* Neynar User Score / Vetting */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-300 mb-2">Neynar User Score / Vetting</h2>
          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 space-y-3">
            {vettingLoading && <p className="text-sm text-gray-400">Loading score...</p>}
            
            {vettingResult && (
              <div className="space-y-3">
                {/* Score Card */}
                <div className={`p-4 rounded-lg border ${vettingResult.isVetted ? 'bg-green-900/20 border-green-700' : 'bg-red-900/20 border-red-700'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400">Neynar Score</span>
                    <span className={`text-2xl font-bold ${TIER_COLORS[vettingResult.tier]}`}>
                      {vettingResult.score.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-400">Tier</span>
                    <span className={`font-semibold ${TIER_COLORS[vettingResult.tier]}`}>
                      {TIER_LABELS[vettingResult.tier]}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">{TIER_DESCRIPTIONS[vettingResult.tier]}</p>
                </div>

                {/* Vetting Status */}
                <div className={`p-3 rounded-lg ${vettingResult.isVetted ? 'bg-green-900/30' : 'bg-red-900/30'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${vettingResult.isVetted ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="font-semibold text-sm">
                      {vettingResult.isVetted ? '✅ User Vetted — Access Granted' : '❌ User Not Vetted — Access Restricted'}
                    </span>
                  </div>
                </div>

                {/* Check Details */}
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Score ≥ {DEFAULT_THRESHOLDS.minScore}</span>
                    <span className={vettingResult.checks.scoreCheck ? 'text-green-400' : 'text-red-400'}>
                      {vettingResult.checks.scoreCheck ? '✅ Pass' : '❌ Fail'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Followers</span>
                    <span className="text-gray-300">{vettingResult.followerCount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Power Badge</span>
                    <span className={vettingResult.powerBadge ? 'text-yellow-400' : 'text-gray-500'}>
                      {vettingResult.powerBadge ? '⭐ Yes' : 'No'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {!vettingResult && !vettingLoading && (
              <p className="text-sm text-gray-500">
                No vetting data available. Run inside Farcaster to auto-fetch your score, or enter a FID above to lookup a user.
              </p>
            )}

            {/* Table Eligibility Matrix */}
            {vettingResult && (
              <div className="mt-3 pt-3 border-t border-gray-700">
                <p className="text-sm font-semibold text-gray-300 mb-2">Table Access Eligibility</p>
                <div className="space-y-2">
                  {[
                    { label: "Practice / Low Stakes (< $50)", minScore: 0, color: "gray" },
                    { label: "Medium Stakes ($50–$99)", minScore: 0.55, color: "blue" },
                    { label: "High Stakes ($100–$499)", minScore: 0.70, color: "green" },
                    { label: "Elite ($500+)", minScore: 0.85, color: "amber" },
                  ].map((tier) => {
                    const eligible = vettingResult.score >= tier.minScore;
                    return (
                      <div key={tier.label} className="flex items-center justify-between text-sm">
                        <span className="text-gray-400">{tier.label}</span>
                        <span className={eligible ? "text-green-400 font-medium" : "text-red-400"}>
                          {eligible ? "✅ Can Join" : `❌ Needs ${(tier.minScore * 100).toFixed(0)}+`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Threshold Info */}
            <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500">
              <p><strong>Default Threshold:</strong> Score ≥ 0.55 (Neynar recommended)</p>
              <p><strong>Strict Threshold:</strong> Score ≥ 0.70 + 50 followers</p>
              <p><strong>Elite Threshold:</strong> Score ≥ 0.85 + Power Badge + 500 followers</p>
            </div>
          </div>
        </div>

        {/* Public URL for Testing */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-300 mb-2">External Testing</h2>
          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 space-y-3">
            <div>
              <label className="text-sm text-gray-400 block mb-1">Your public URL (from ngrok / cloudflare tunnel):</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={publicUrl}
                  onChange={(e) => setPublicUrl(e.target.value)}
                  placeholder="https://xxxx.ngrok-free.app"
                  className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500"
                />
                <button
                  onClick={() => publicUrl && copyToClipboard(publicUrl)}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg text-sm transition"
                >
                  Copy
                </button>
              </div>
              {copyStatus && <span className="text-green-400 text-sm ml-1">{copyStatus}</span>}
            </div>

            <div className="space-y-2">
              <a
                href={publicUrl ? `https://farcaster.xyz/~/developers/mini-apps/preview?url=${encodeURIComponent(publicUrl)}` : "https://farcaster.xyz/~/developers/mini-apps/preview"}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-purple-600 hover:bg-purple-500 text-white text-center py-2 px-4 rounded-lg text-sm font-medium transition"
              >
                Open Farcaster Mini App Previewer →
              </a>
              <a
                href="https://farcaster.xyz/~/developers/"
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-gray-700 hover:bg-gray-600 text-white text-center py-2 px-4 rounded-lg text-sm font-medium transition"
              >
                Open Warpcast Developer Tools →
              </a>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-300 mb-2">Quick Links</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Link href="/" className="text-blue-400 hover:text-blue-300 underline">
              ← Back to App
            </Link>
            <a href="/.well-known/farcaster.json" target="_blank" className="text-blue-400 hover:text-blue-300 underline">
              View Manifest →
            </a>
            <a href="/api/table" target="_blank" className="text-blue-400 hover:text-blue-300 underline">
              API Table →
            </a>
            <a href="https://docs.neynar.com/docs/how-to-build-farcaster-frames-with-neynar" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
              Neynar Docs →
            </a>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-gray-500 text-xs pt-4 border-t border-gray-800">
          ZAO Poker Tester v1.0 — For pre-deployment validation
        </div>
      </div>
    </div>
  );
}
