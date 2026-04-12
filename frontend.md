# ConsentFlow — Frontend Development Plan

> **Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · TanStack Query · Axios
> **Design:** Dark mesh gradient (Google Stitch-inspired) · DM Serif Display + DM Sans · Glass panels

---

## Quick Reference

| Item | Value |
|---|---|
| Framework | Next.js 14 with App Router |
| Language | TypeScript (strict mode) |
| Styling | Tailwind CSS + shadcn/ui |
| Data fetching | TanStack Query v5 (polling, caching) |
| HTTP client | Axios (centralized instance) |
| Charts | Recharts |
| Fonts | DM Serif Display + DM Sans (Google Fonts) |
| Backend base URL | `http://localhost:8000` (no `/api/v1` prefix) |
| Auth | None — proxy via Next.js API routes |

---

## 1. Critical Pre-Work (Do Before Any UI)

### 1.1 Fix CORS on the backend

Add this to `consentflow/app/main.py` before starting frontend work. Without it, every browser request fails.

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 1.2 Environment variables

Create `.env.local` in the Next.js root:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 1.3 UUID validation rule

Every `user_id` field sent to the API must be a valid UUID. Validate client-side before any request — a plain string or integer will return a `422 Unprocessable Entity` and cascade errors across the UI.

---

## 2. Project Setup

```bash
npx create-next-app@latest consentflow-frontend \
  --typescript --tailwind --eslint --app 

cd consentflow-frontend

# Install dependencies
npm install axios @tanstack/react-query recharts
npx shadcn@latest init
npx shadcn@latest add button input label badge card table dialog toast
```

### Folder structure

```
consentflow-frontend/
├── app/
│   ├── layout.tsx              # Root layout, fonts, QueryProvider
│   ├── page.tsx                # Landing page (/)
│   ├── dashboard/page.tsx
│   ├── users/page.tsx
│   ├── consent/page.tsx
│   ├── audit/page.tsx
│   ├── webhook/page.tsx
│   ├── infer/page.tsx
│   └── api/                    # Next.js API routes (proxy layer)
│       ├── health/route.ts
│       ├── users/route.ts
│       ├── consent/route.ts
│       ├── audit/route.ts
│       ├── webhook/route.ts
│       └── infer/route.ts
├── components/
│   ├── ui/                     # shadcn auto-generated
│   ├── layout/
│   │   ├── Navbar.tsx
│   │   └── Sidebar.tsx
│   ├── consent/
│   │   ├── ConsentStatusBadge.tsx
│   │   ├── ConsentForm.tsx
│   │   └── ConsentMatrix.tsx
│   ├── users/
│   │   └── UserSearchBar.tsx
│   ├── audit/
│   │   └── AuditTable.tsx
│   ├── dashboard/
│   │   ├── HealthWidget.tsx
│   │   └── MetricCard.tsx
│   └── webhook/
│       └── WebhookPayloadEditor.tsx
├── lib/
│   ├── axios.ts                # Axios instance + interceptors
│   ├── queryClient.ts          # TanStack Query client config
│   └── utils.ts                # UUID validator, date formatters
├── hooks/
│   ├── useHealth.ts
│   ├── useConsent.ts
│   ├── useAuditTrail.ts
│   └── useUsers.ts
└── types/
    └── api.ts                  # TypeScript interfaces for all API shapes
```

---

## 3. Core Setup Files

### `lib/axios.ts` — centralized HTTP client

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach X-User-ID header when available (for /infer routes)
api.interceptors.request.use((config) => {
  const userId = sessionStorage.getItem('active_user_id');
  if (userId) config.headers['X-User-ID'] = userId;
  return config;
});

export default api;
```

### `types/api.ts` — TypeScript shapes from backend

```typescript
export type ConsentStatus = 'granted' | 'revoked';

export interface User {
  id: string;
  email: string;
  created_at: string;
}

export interface ConsentRecord {
  id: string;
  user_id: string;
  data_type: string;
  purpose: string;
  status: ConsentStatus;
  updated_at: string;
  cached?: boolean;
}

export interface AuditEntry {
  id: string;
  event_time: string;
  user_id: string;
  gate_name: string;
  action_taken: 'ALLOW' | 'BLOCKED';
  consent_status: string;
  purpose: string | null;
  metadata: Record<string, unknown> | null;
  trace_id: string | null;
}

export interface AuditTrailResponse {
  entries: AuditEntry[];
  total: number;
}

export interface HealthResponse {
  status: string;
  postgres: string;
  redis: string;
}

export interface WebhookResponse {
  status: 'propagated' | 'partial';
  user_id: string;
  purpose: string;
  kafka_published: boolean;
  warning: string | null;
}
```

---

## 4. Pages — Build Order & API Mapping

### Phase 1 — Dashboard `/dashboard`

**Purpose:** System health at a glance + recent audit activity.

**API calls:**
- `GET /health` — polls every 30s
- `GET /audit/trail?limit=10` — recent events preview

**Components to build:**
- `HealthWidget` — shows postgres/redis status dots (green/red). Polls every 30 seconds using `refetchInterval`.
- `MetricCard` — reusable stat tile (label + large number)
- Metric cards: Total consents checked today, blocked inferences, active users
- Audit preview table (last 10 entries)

**Key notes:**
- Health endpoint returns `{ status, postgres, redis }`. Show each service separately.
- If any service is not `"ok"`, flash a banner across the top of the page.

---

### Phase 2 — Users `/users`

**Purpose:** Register users and look them up by UUID.

**API calls:**
- `POST /users` — register new user
- `GET /users/{user_id}` — fetch user by UUID

**Components to build:**
- `UserSearchBar` — UUID text input with client-side format validation before firing the request. Show a red helper text if the string is not a valid UUID format before the request even fires.
- Registration form — email input → POST /users → show returned UUID prominently so the user can copy it for use in other pages
- User detail card — shows `id`, `email`, `created_at`

**Error states to handle:**
- `404` — "No user found with this ID"
- `409` — "This email is already registered"
- `422` — Invalid UUID format (catch client-side before sending)

---

### Phase 3 — Consent Manager `/consent`

**Purpose:** Grant, revoke, and inspect consent records per user and purpose.

**API calls:**
- `POST /consent` — upsert a consent record
- `POST /consent/revoke` — revoke all records for user + purpose
- `GET /consent/{user_id}/{purpose}` — check current status

**Components to build:**
- `ConsentForm` — dropdowns for `data_type` (pii, webhook), `purpose` (analytics, inference, model_training), `status` (granted, revoked) + user_id UUID input
- `ConsentStatusBadge` — green pill for `granted`, red pill for `revoked`. Show a small cache icon (⚡) when `cached: true` is returned.
- `ConsentMatrix` — table with users as rows, purposes as columns, showing badge per cell. Refresh via polling.
- Revoke confirmation modal — confirm before firing `POST /consent/revoke` since it revokes ALL data types for that purpose.

**Key notes:**
- `POST /consent` is an upsert — it creates or updates in place.
- `POST /consent/revoke` targets ALL `data_type` values matching `user_id` + `purpose`.
- The `cached` field in `GET /consent/{user_id}/{purpose}` response tells you if Redis served the result.

---

### Phase 4 — Audit Trail `/audit`

**Purpose:** Full searchable log of all gate enforcement decisions.

**API calls:**
- `GET /audit/trail?user_id=&gate_name=&limit=100`

**Components to build:**
- `AuditTable` — paginated table with columns: time, user_id (truncated UUID), gate_name, action_taken, consent_status, purpose, trace_id
- Filter bar — inputs for `user_id`, `gate_name` select (inference_gate, dataset_gate, training_gate, monitoring_gate), limit slider
- Action badge — `ALLOW` in green, `BLOCKED` in red
- `trace_id` copy button — one-click copy to clipboard for debugging with OTel

**Key notes:**
- API max limit is 1000. Default to 100. Add a limit selector (50, 100, 250, 500, 1000).
- Poll every 15 seconds with `refetchInterval: 15000` to keep the table live.
- `gate_name` comes from the backend as-is (e.g. `inference_gate`). Display as formatted label ("Inference gate").

---

### Phase 5 — Webhook Simulator `/webhook`

**Purpose:** Fire OneTrust-style revocation payloads and inspect the result.

**API calls:**
- `POST /webhook/consent-revoke`

**Components to build:**
- `WebhookPayloadEditor` — editable JSON textarea pre-filled with the example payload:
```json
{
  "userId": "",
  "purpose": "analytics",
  "consentStatus": "revoked",
  "timestamp": "2026-04-12T10:00:00Z"
}
```
- Fire button — sends payload, shows raw response
- Response panel — shows status code, `kafka_published` boolean, `warning` field
- **207 handling** — if response is 207, show a yellow warning banner: "DB saved, but Kafka publish failed." This is distinct from a full 200 success.

**Key notes:**
- The webhook only accepts `consentStatus: "revoked"` — anything else returns 422. Validate in the UI before sending.
- `camelCase` field names (`userId`, `consentStatus`) — note this differs from the rest of the API which uses `snake_case`.

---

### Phase 6 — Inference Tester `/infer`

**Purpose:** Live test of the ConsentMiddleware gate.

**API calls:**
- `POST /infer/predict` with header `X-User-ID: {uuid}`

**Components to build:**
- UUID input — sets `X-User-ID` header. Store in sessionStorage for persistence across page navigation.
- Prompt textarea — freeform text to simulate a model prompt
- Fire button → shows result panel:
  - `200 OK` → green "Inference allowed" card + `prediction` value
  - `403 Forbidden` → red "Blocked — consent revoked" card
  - `400 Bad Request` → orange "Missing or invalid user ID" card
  - `503 Service Unavailable` → gray "Consent engine unavailable" card

**Key notes:**
- The middleware reads `X-User-ID` header OR `user_id` from the JSON body. Prefer the header approach.
- This is a test/demo endpoint — label it clearly in the UI as a ConsentMiddleware testing tool.

---

## 5. Reusable Components Spec

### `ConsentStatusBadge`

```tsx
// Props: status: 'granted' | 'revoked', cached?: boolean
// granted → green badge
// revoked → red badge
// cached: true → show ⚡ icon before the text
```

### `MetricCard`

```tsx
// Props: label: string, value: string | number, accent?: 'green' | 'red' | 'purple'
// Dark glass surface card with large number and small muted label
```

### `AuditTable`

```tsx
// Props: entries: AuditEntry[], loading: boolean
// Renders paginated table
// action_taken ALLOW → green badge, BLOCKED → red badge
// trace_id column → copy button if not null
```

### `HealthWidget`

```tsx
// Polls GET /health every 30 seconds
// Shows three dots: overall status, postgres, redis
// Dot color: green = ok, red = anything else
// If any dot is red, emit an onDegraded callback to show top-level banner
```

---

## 6. Error Handling Strategy

Handle these HTTP codes uniformly across all pages:

| Code | Meaning | UI treatment |
|---|---|---|
| `400` | Missing user identity | Orange toast: "User ID required" |
| `403` | Consent revoked | Red banner: "Access blocked — consent revoked" |
| `404` | Resource not found | Inline empty state with message |
| `409` | Duplicate email | Inline field error on email input |
| `422` | Invalid payload / bad UUID | Inline field error before request fires |
| `500` | Server error | Red toast: "Server error — try again" |
| `503` | Consent engine down | Red banner: "Consent engine unavailable" |
| `207` | Partial success (Kafka fail) | Yellow warning banner |

Use a global Axios response interceptor to catch 500 and 503 and show a toast automatically.

---

## 7. Polling Strategy

| Data | Endpoint | Interval |
|---|---|---|
| System health | `GET /health` | 30s |
| Audit trail | `GET /audit/trail` | 15s |
| Consent status | `GET /consent/:id/:purpose` | On demand (no auto-poll) |

Use TanStack Query's `refetchInterval` option. Add a visible "Last updated X seconds ago" timestamp next to live-polled data.

---

## 8. Design System

### Colors (CSS variables)

```css
:root {
  --bg: #06080f;
  --surface: rgba(255,255,255,0.045);
  --border: rgba(255,255,255,0.09);
  --text: #f0f2f8;
  --muted: rgba(240,242,248,0.45);
  --accent: #7c6dfa;       /* purple — primary actions */
  --accent2: #3ecfb2;      /* teal — success / granted */
  --accent3: #fa6d8a;      /* coral — danger / revoked */
}
```

### Typography

```css
/* Display headings */
font-family: 'DM Serif Display', serif;

/* Body, UI, labels */
font-family: 'DM Sans', sans-serif;
```

Import in `app/layout.tsx` via `next/font/google`.

### Status colors

- `granted` → teal (`--accent2`)
- `revoked` → coral (`--accent3`)
- `ALLOW` → green
- `BLOCKED` → red
- `warning` / `207` → amber
- `cached` indicator → purple (`--accent`)

---

## 9. Build Phases Summary

| Phase | Pages | Days | Depends on |
|---|---|---|---|
| 0 — Setup | Project init, CORS fix, axios, types | Day 1 | Backend running |
| 1 — Dashboard | `/dashboard` | Day 1–2 | Health + Audit endpoints |
| 2 — Users | `/users` | Day 2 | POST /users, GET /users/:id |
| 3 — Consent | `/consent` | Day 2–3 | All consent endpoints |
| 4 — Audit | `/audit` | Day 3–4 | GET /audit/trail |
| 5 — Webhook | `/webhook` | Day 4 | POST /webhook/consent-revoke |
| 6 — Inference | `/infer` | Day 4–5 | POST /infer/predict + middleware |
| 7 — Polish | Landing page, dark mode, skeletons | Day 5+ | All pages done |

---

## 10. Demo Script (Hackathon Flow)

Use this order to demonstrate ConsentFlow end-to-end:

1. Open `/dashboard` — show healthy postgres + redis status
2. Go to `/users` — register `alice@example.com`, copy the UUID
3. Go to `/consent` — grant consent for `purpose: inference`, `data_type: pii`
4. Go to `/infer` — paste UUID, fire a predict → see `200 OK` (allowed)
5. Go to `/webhook` — fire a revocation webhook for that UUID + purpose
6. Back to `/infer` — fire again → see `403 Forbidden` (blocked)
7. Go to `/audit` — show the full gate decision log with ALLOW then BLOCKED entries
8. Go to `/consent` — show the status badge flipped to `revoked`

This sequence shows the entire consent lifecycle — grant, infer, revoke, block — in under 2 minutes.

---

*ConsentFlow Frontend Plan — v1.0 — Generated April 2026*