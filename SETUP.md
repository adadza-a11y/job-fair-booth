# CUE Job Fair 2026 — Booth Reservation System
## Setup & Deployment Guide

---

## 1. Firebase Setup

You can either create a **new Firebase project** (recommended — keeps it separate from the graduation system) or reuse `grad-event-2026` with the new `jf_` collections.

### Option A — New Firebase project (recommended)
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it e.g. `cue-job-fair-2026`
3. Disable Google Analytics (not needed) → Create project
4. Go to **Firestore Database** → Create database → Start in **production mode** → choose region
5. Go to **Firestore → Rules** → paste:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```
   → Publish
6. Go to **Project Settings** (gear icon) → **Your apps** → **Add app** → Web (`</>`)
7. Register app → copy the `firebaseConfig` object

### Option B — Reuse grad-event-2026
- The app uses collections `jf_reservations` and `jf_codes` (prefixed with `jf_`)
- These are separate from the graduation system's `reservations` collection
- No Firestore rule changes needed (already `allow read, write: if true`)
- Just paste the existing grad-event-2026 config into `firebase.js`

### Paste config into firebase.js
Open `src/firebase.js` and replace the placeholder values:
```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

---

## 2. Local Development

```bash
cd job-fair-booth
npm install
npm run dev
```
Open http://localhost:5173

---

## 3. Deploy to Vercel

1. Push this folder to a new GitHub repo (e.g. `job-fair-booth`)
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo
3. Framework preset: **Vite** (auto-detected)
4. Click **Deploy** — done in ~60 seconds
5. Vercel gives you a URL like `job-fair-booth.vercel.app`

Auto-deploys on every push to `main`.

---

## 4. Admin Access

- Click the **"JOB FAIR 2026"** title **5 times** → admin login prompt appears
- Password: `jobfair2026admin`
  - ⚠️ Change this in `src/App.jsx` line: `const ADMIN_PW = "jobfair2026admin";`
- Admin tabs:
  - **🗺 Map** — see all booths, click reserved booth to cancel
  - **🔑 Codes** — generate, view, and delete access codes
  - **📋 List** — full reservation table, export CSV

---

## 5. Access Code Workflow

### Before the event (your to-do):
1. Log in as admin → go to **🔑 Codes** tab
2. Enter quantity (e.g. 33) and optional prefix (e.g. `JF`) → click **Generate**
3. Generated codes appear immediately — click **Copy All**
4. Distribute one code per invited company (email, WhatsApp, etc.)

### What companies see:
1. Open the site → enter their unique code → click Continue
2. Floor plan appears — green booths are available, red are taken
3. Click a green booth → fill in company name, contact details → confirm
4. Success screen confirms their booth

### Rules enforced:
- Each code works **once only** — after use it's locked to that company's booth
- If a reservation is **cancelled by admin**, the code is automatically freed (company can re-book)
- Codes can be **deleted** by admin before use (e.g. if a company drops out)

---

## 6. Floor Plan Layout Reference

```
NORTH WALL
┌─────────────────────────────────────────────────────────────┐
│  [17][16][15][14][13][12][11][10][ 9]  ← top row (9 booths) │
│                                                              │
│    [18][19][20][21][22][23][24][25]    ← island top face     │
│    [33][32][31][30][29][28][27][26]    ← island bottom face  │
│                                                              │
│    [ 1][ 2][ 3][ 4][ 5][ 6][ 7][ 8]  ← bottom row (8 booths)│
└─────────────────────────────────────────────────────────────┘
SOUTH WALL
```

- **33 booths total** — each 3m wide × 2m deep
- Venue: CUE Main Cafeteria

---

## 7. Firestore Data Structure

**`jf_reservations/{boothId}`**
```json
{
  "companyName": "Acme Corp",
  "contactName": "John Doe",
  "contactEmail": "john@acme.com",
  "contactPhone": "+964 750 123 4567",
  "code": "AB3X7K2M",
  "ts": 1748520000000
}
```

**`jf_codes/{code}`**
```json
{
  "used": false,
  "companyName": "",
  "boothId": null,
  "createdAt": 1748520000000
}
```

---

## 8. Project Info

| | |
|---|---|
| Admin password | `jobfair2026admin` |
| Collections | `jf_reservations`, `jf_codes` |
| Total booths | 33 |
| Booth size | 3m × 2m |
| Venue | CUE Main Cafeteria |
