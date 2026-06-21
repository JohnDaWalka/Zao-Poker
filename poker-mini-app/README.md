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
*   `TURSO_CONNECTION_URL`: Turso DB Connection URI
*   `TURSO_AUTH_TOKEN`: Turso DB Access Token

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
