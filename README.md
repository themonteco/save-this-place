# Save This Place

A voice-driven web app for marking the spots worth coming back to. Built with React, Supabase (auth + database), and Anthropic Claude (the "Ask" feature). Designed as a PWA so it installs to your iPhone home screen and behaves like a native app.

---

## Deployment guide (about 20 minutes, no coding required)

You'll create three free accounts (GitHub, Supabase, Vercel), copy-paste a few values, and click Deploy. At the end you'll have a real URL like `save-this-place.vercel.app` that you and anyone you share it with can install on their phone.

### Step 1 — Put this code on GitHub (5 min)

1. Sign up at [github.com](https://github.com) if you don't have an account.
2. Click the **+** in the top-right → **New repository**.
3. Name it `save-this-place`, leave it Public or Private (your choice), and click **Create repository**.
4. On the next page, click **uploading an existing file**.
5. Drag this whole `save-this-place-app` folder into the browser. Wait for the upload to finish.
6. Scroll down, click **Commit changes**.

### Step 2 — Create the Supabase backend (5 min)

1. Sign up at [supabase.com](https://supabase.com). Click **New project**.
2. Name it `save-this-place`. Pick a strong database password (save it somewhere). Pick the region closest to you. Click **Create new project**. Wait ~1 minute for it to spin up.
3. In the left sidebar, click the **SQL Editor** icon (looks like a database with a play button).
4. Click **+ New query**.
5. Open the file `supabase/schema.sql` from this project in any text editor, copy its entire contents, paste into the SQL editor, click **Run** (bottom right). You should see "Success. No rows returned."
6. In the left sidebar, click **Authentication** → **Providers**. Make sure **Email** is enabled (it's on by default). For easier testing, scroll down and **uncheck "Confirm email"** — this lets accounts work immediately without email verification. You can re-enable this later.
7. In the left sidebar, click the **gear** (Project Settings) → **API**. You'll need two values from this page in Step 4:
   - **Project URL** (looks like `https://abcdefg.supabase.co`)
   - **anon / public** key (a long string starting with `eyJ...`)

### Step 3 — Get an Anthropic API key (3 min)

1. Sign up at [console.anthropic.com](https://console.anthropic.com).
2. Click **Get API keys** → **Create Key**. Name it `save-this-place`. Copy the key (starts with `sk-ant-api03-...`). Save it somewhere — you can't view it again.
3. New accounts get $5 in free credits, plenty for personal use. Each Ask call costs less than a cent.

### Step 4 — Deploy on Vercel (5 min)

1. Sign up at [vercel.com](https://vercel.com) using your GitHub account ("Continue with GitHub").
2. On the dashboard, click **Add New** → **Project**.
3. Find your `save-this-place` repo and click **Import**.
4. Before clicking Deploy, expand the **Environment Variables** section and add these three (paste the values from Steps 2 and 3):

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Your Project URL from Step 2.7 |
   | `VITE_SUPABASE_ANON_KEY` | Your anon key from Step 2.7 |
   | `ANTHROPIC_API_KEY` | Your Anthropic key from Step 3.2 |

5. Click **Deploy**. Wait ~2 minutes.
6. You get a URL like `https://save-this-place.vercel.app`. **That's your app.**

### Step 5 — Install it on your iPhone (1 min)

1. Open the Vercel URL in **Safari** (not Chrome — only Safari supports Add to Home Screen properly on iOS).
2. Tap the Share icon at the bottom.
3. Scroll down and tap **Add to Home Screen**.
4. Tap **Add**.
5. Open the app from your home screen. It'll run full-screen with no browser bars. Mic and location will ask permission on first use — say yes.

### Step 6 — Share it with friends

Just send them the URL. They visit it, create an account, install on their phone the same way. Each person has their own private list of places.

---

## What works in this version

- **Voice save**: tap the orange button, talk, Claude generates a clean title automatically
- **Cross-device sync**: sign in on any device, see all your places
- **Apple Maps + Google Maps**: every place opens in both with one tap
- **iMessage sharing**: tap "Send to a Friend" to share a place with anyone (they don't need the app)
- **Ask**: voice-ask your saved places ("what's near me?", "plan a day trip")
- **Photos**: snap a photo when saving, see thumbnails in your list
- **Search & categories**: places are auto-categorized into nature, food, camping, shops, city
- **Multi-user**: each account has its own private collection

## Costs

- **Vercel**: free for personal projects, no credit card required
- **Supabase**: free up to 500MB database + 50,000 monthly active users
- **Anthropic**: $5 free trial credit, then pay-as-you-go (Haiku model is very cheap — fractions of a cent per Ask)

So: $0/month for personal use.

## Common issues

**"Failed to fetch" when using Ask** — Your `ANTHROPIC_API_KEY` env var isn't set in Vercel, or has a typo. Go to your Vercel project → Settings → Environment Variables and check. After changing env vars, redeploy from the Deployments tab.

**Mic doesn't work on iPhone** — Make sure the app is installed from Safari (not Chrome). The first time you tap the orange button, iOS asks for permission. If you said No, go to Settings → Safari → Microphone and allow.

**Location doesn't work** — Same as above but for Location. Settings → Privacy → Location Services → Safari Websites → Allow.

**Sign up says "Email not confirmed"** — Go back to Supabase Authentication → Providers → Email and uncheck "Confirm email", or check your inbox for the confirmation link.

**Want to change app name or icon** — Edit `index.html` (title and apple-mobile-web-app-title meta tags) and replace the PNG files in `public/`. Push changes; Vercel auto-deploys.

## Tech stack

- React 18 + Vite (frontend)
- Tailwind CSS (styling)
- Framer Motion (animations)
- Lucide (icons)
- Supabase (auth + Postgres + storage)
- Vercel Edge Functions (Claude API proxy)
- Web Speech API (browser voice recognition, free)

## Local development (optional)

If you want to run the app on your laptop before deploying:

```bash
npm install
cp .env.local.example .env.local
# Edit .env.local and fill in your Supabase + Anthropic values
npm run dev
```

Opens at http://localhost:5173.

---

## What's next

Things you might want to add later:

- **In-app place sharing**: when a friend opens a shared link, the place gets added to their account with one tap. Currently sharing uses Apple/Google Maps URLs which work without the app.
- **Trips**: group places into named trips ("Big Sur 2026")
- **Better photo storage**: move from base64 in database to Supabase Storage for big libraries
- **Native iOS app**: wrap in Capacitor for App Store distribution and a real widget on the lock screen

Ask me to build any of these when you're ready.
