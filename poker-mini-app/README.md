# ZAO Poker Mini App 🪐

This is the Next.js React frontend for the ZAO Poker Farcaster Mini App, built on the Neynar Farcaster template. It features a complete poker game table UI, player social profile loading (avatars and usernames), and real-time syncing via a Turso SQLite database.

## 🛠️ Tech Stack
*   **Framework**: Next.js (App Router) + TypeScript
*   **Styling**: Vanilla Tailwind CSS
*   **Web3/Identity**: Neynar Auth (Farcaster SDK) + Wagmi/Viem
*   **Database**: Turso (SQLite client)
*   **AI Integration**: Proxy requests to the `AI-Poker-Coach` backend

---

## 🚀 Getting Started

### 1. Installation
Install dependencies with legacy peer dependency handling:
```bash
npm install --legacy-peer-deps
```

### 2. Environment Variables
Create a `.env.local` file by copying the example:
```bash
cp .env.example .env.local
```
Configure your keys:
*   `NEXT_PUBLIC_NEYNAR_CLIENT_ID`: Your Neynar app client ID
*   `TURSO_DATABASE_URL`: Turso DB Connection URI (`TURSO_CONNECTION_URL` is also accepted for backwards compatibility)
*   `TURSO_AUTH_TOKEN`: Turso DB Access Token

**For production persistence on Farcaster (recommended):**
*   Deploy a dedicated lobby service (real-time state, WS, game actions) to **Render.com**.
*   Set `NEXT_PUBLIC_RENDER_API_URL` and `NEXT_PUBLIC_RENDER_WS_URL` (pointing to your Render service).
*   The frontend on **Vercel** will use Render for authoritative table state (hands, board, actions between hands).
*   This ensures reliable persistence in the Farcaster mini-app context.

### 3. Running in Development
Run the local dev server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📦 Deployment to Vercel

To deploy the frontend to Vercel:
1. Connect this repository to Vercel.
2. In the project settings, set the **Root Directory** to `poker-mini-app`.
3. Configure your production environment variables.
4. Deploy!
# Turso Database Configuration
 
