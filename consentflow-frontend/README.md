# ConsentFlow — Frontend

> **Next.js 16.2 (App Router) · React 19 · TypeScript · TailwindCSS v4**
> Dev port: **3001** | Proxies to FastAPI backend at `http://localhost:8000`

---

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:3001
```

Requires the ConsentFlow backend running at `http://localhost:8000`.
See `../consentflow-backend/README.md` for backend setup.

---

## Pages

| Route | File | Purpose |
|-------|------|---------|
| `/` | `app/page.tsx` | Landing — animated flow diagram, 5-gate architecture overview |
| `/dashboard` | `app/dashboard/page.tsx` | Live metrics, audit table, health widget, inference sparkline, Gate 05 card |
| `/users` | `app/users/page.tsx` | User registry — list, register, set active user for inference testing |
| `/consent` | `app/consent/page.tsx` | Grant / revoke consent records |
| `/audit` | `app/audit/page.tsx` | Full audit trail with gate filter and trace IDs |
| `/webhook` | `app/webhook/page.tsx` | OneTrust webhook simulator |
| `/infer` | `app/infer/page.tsx` | Inference gate tester (shows 200 → 403 after revocation) |
| `/policy` | `app/policy/page.tsx` | Gate 05 — Policy Auditor (LLM ToS scan via Claude) |

---

## API Proxy Routes

All backend calls go through Next.js API routes to avoid CORS:

| Proxy | Forwards to |
|-------|-------------|
| `GET /api/health` | `GET /health` |
| `GET/POST /api/audit` | `GET /audit/trail` |
| `GET/POST /api/consent` | `GET/POST /consent` |
| `GET/POST /api/users` | `GET/POST /users` |
| `POST /api/infer` | `POST /infer/predict` |
| `POST /api/webhook` | `POST /webhook/consent-revoke` |
| `GET /api/dashboard-stats` | `GET /dashboard/stats` |
| `POST /api/policy` | `POST /policy/scan` + `GET /policy/scans` |

---

## Key Files

```
app/
  page.tsx              Landing page
  dashboard/page.tsx    Dashboard (Gate 01-05 cards, live metrics)
  policy/page.tsx       Gate 05 — Policy Auditor
  api/policy/route.ts   Proxy for /policy/scan and /policy/scans
hooks/
  useAuditTrail.ts      TanStack Query — audit trail
  useConsent.ts         TanStack Query — consent records
  useHealth.ts          TanStack Query — health check
  usePolicyAuditor.ts   TanStack Query — scan + history (Gate 05)
  useUsers.ts           TanStack Query — user list
lib/
  axios.ts              Singleton Axios with X-User-ID interceptor
components/
  dashboard/MetricCard  Reusable metric card
  dashboard/HealthWidget Backend health indicator
  layout/Sidebar        Navigation sidebar
```

---

## Environment

`.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Demo Flow (2 min)

1. `/` — landing, animated 5-gate diagram
2. `/dashboard` — live metrics including "Policies Scanned" card
3. `/users` — set demo user as active
4. `/infer` — fire inference → **green Allowed**
5. `/webhook` — simulate revocation
6. `/infer` → **red Blocked (403)**
7. `/dashboard` — blocked counter incremented
8. `/audit` — full trace entry
9. `/policy` — paste any AI vendor ToS URL → Claude finds bypass clauses
