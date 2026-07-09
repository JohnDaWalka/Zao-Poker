// ---------------------------------------------------------------------------
// Deployment health check
// Usage:
//   node scripts/check-deploy.mjs https://your-render-service.onrender.com
// Or set env vars:
//   NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_RENDER_API_URL
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 25_000; // 25 s — covers Render cold-start wake-ups

const appUrl = (
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXT_PUBLIC_URL ??
  ""
).replace(/\/$/, "");

if (!appUrl) {
  console.error("Missing app URL. Set NEXT_PUBLIC_APP_URL or NEXT_PUBLIC_URL.");
  process.exit(1);
}

const renderApiUrl = (
  process.env.NEXT_PUBLIC_RENDER_API_URL ?? process.argv[2] ?? ""
).replace(/\/$/, "");

if (!renderApiUrl) {
  console.log("No Render API URL provided. Skipping Render backend checks.");
}

/** Fetch a URL with a timeout and print the result. Returns true on 2xx. */
async function checkJson(label, url, { optional = false } = {}) {
  console.log(`\n▶ ${label}`);
  console.log(`  URL: ${url}`);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    console.log(`  Status: ${res.status}`);

    const text = await res.text();
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      console.log(text.slice(0, 500));
    }

    if (!res.ok) {
      const tag = optional ? "WARN (optional)" : "FAIL";
      console.error(`  [${tag}] Non-2xx response`);
    }

    return res.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const tag = optional ? "WARN (optional)" : "FAIL";
    console.error(`  [${tag}] ${message}`);
    return optional; // optional failures don't block exit code
  }
}

const failures = [];

function record(label, ok) {
  if (!ok) failures.push(label);
}

// --- Frontend checks ---
record("Frontend root",      await checkJson("Frontend root",      appUrl));
record("Farcaster manifest", await checkJson("Farcaster manifest", `${appUrl}/.well-known/farcaster.json`));
// manifest.webmanifest is served by Next.js App Router — mark optional so a
// local dev server (which may not build manifest routes) doesn't block CI.
record("PWA manifest",       await checkJson("PWA manifest",       `${appUrl}/manifest.webmanifest`, { optional: true }));
record("In-app tester",      await checkJson("In-app tester",      `${appUrl}/tester`, { optional: true }));

// --- Backend checks ---
if (renderApiUrl) {
  record("Render health",  await checkJson("Render health",  `${renderApiUrl}/health`));
  record("Render lobby",   await checkJson("Render lobby",   `${renderApiUrl}/lobby`));
}

// --- Database smoke test via the Next.js API layer ---
record("API table (DB)", await checkJson("API table (DB)", `${appUrl}/api/table`));

if (failures.length > 0) {
  console.error(`\n✖ ${failures.length} check(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}

console.log("\n✔ All deploy checks passed.");
