# ZAO Poker 🃏

ZAO Poker is a Web3 Farcaster Mini-App (Frames v2) featuring a real-time multiplayer poker game table, a Counterfactual Regret Minimization (CFR/GTO) mathematical engine, and an AI coaching companion powered by Google Gemini.

---

## 📁 Repository Structure

This repository is organized as a monorepo containing the following components:

*   **[`poker-mini-app`](./poker-mini-app/)**: The Next.js, React, and TypeScript frontend built for the Farcaster Frame context, featuring Neynar Auth and Turso SQLite database syncing.
*   **[`AI-Poker-Coach`](./AI-Poker-Coach/)**: The Python FastAPI backend running the AI analysis pipeline, Monte Carlo equity simulations, and the CFR mathematical models.
*   **[`LeakSnipe`](./LeakSnipe/)**: Desktop OCR-based HUD and hand history tracker.
*   **[`Poker-COACH`](./Poker-COACH/)**: Command-line poker training suite and tools.
*   **[`poker-snap`](./poker-snap/)**: Neynar agent scripts and event-hook handlers.

---

## 🚀 Running Locally

### 1. Backend Setup (`AI-Poker-Coach`)
1. Navigate to the backend directory:
   ```bash
   cd AI-Poker-Coach
   ```
2. Create a virtual environment and install dependencies:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. Create an `env.yaml` file in the root of `ZAO_POKER/env.yaml` (or `AI-Poker-Coach/env.yaml`) with your Gemini API Key:
   ```yaml
   GEMINI_API_KEY: "your_google_ai_studio_key_here"
   ```
4. Run the FastAPI server:
   ```bash
   uvicorn server:app --reload --port 8080
   ```
   The API will be live at `http://localhost:8080`.

### 2. Frontend Setup (`poker-mini-app`)
1. Navigate to the frontend directory:
   ```bash
   cd poker-mini-app
   ```
2. Install the required Node dependencies:
   ```bash
   npm install --legacy-peer-deps
   ```
3. Set up your environment variables in `.env.local` (copy from `.env.example`):
   *   `NEXT_PUBLIC_NEYNAR_CLIENT_ID`
   *   `TURSO_CONNECTION_URL`
   *   `TURSO_AUTH_TOKEN`
4. Run the development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` to view the app.

---

## 🌐 Production Deployment

### Backend (Render.com)
The backend is Dockerized and ready to deploy to Render:
1. Create a new **Web Service** on Render and connect this repository.
2. Set the **Root Directory** to `AI-Poker-Coach`.
3. Select **Docker** as the runtime.
4. Add the environment variable:
   *   `GEMINI_API_KEY` = `your_google_ai_studio_api_key`
5. Deploy.

### Frontend (Vercel)
1. Link your Vercel project to this repository.
2. Set the **Root Directory** to `poker-mini-app`.
3. Configure your Farcaster/Neynar environment variables.
4. Deploy.
