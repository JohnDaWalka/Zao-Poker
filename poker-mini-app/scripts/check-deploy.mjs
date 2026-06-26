const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXT_PUBLIC_URL ??
  "https://poker-mini-app-nine.vercel.app";

const renderApiUrl =
  process.env.NEXT_PUBLIC_RENDER_API_URL ?? process.argv[2];

if (!renderApiUrl) {
  console.error("Missing Render API URL.");
  console.error(
    "Usage: node scripts/check-deploy.mjs https://your-render-service.onrender.com"
  );
  process.exit(1);
}

async function checkJson(label, url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    console.log(`\n${label}`);
    console.log(`URL: ${url}`);
    console.log(`Status: ${res.status}`);

    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      console.log(text.slice(0, 500));
    }

    return res.ok;
  } catch (error) {
    console.error(`\n${label} failed:`, error instanceof Error ? error.message : error);
    return false;
  }
}

const results = [];

results.push(await checkJson("Frontend root", appUrl));
results.push(
  await checkJson("Farcaster manifest", `${appUrl}/.well-known/farcaster.json`)
);
results.push(await checkJson("PWA manifest", `${appUrl}/manifest.webmanifest`));
results.push(await checkJson("Render health", `${renderApiUrl}/health`));
results.push(await checkJson("Render lobby", `${renderApiUrl}/lobby`));

if (results.some((ok) => !ok)) {
  console.error("\nOne or more checks failed.");
  process.exit(1);
}

console.log("\nAll deploy checks passed.");
