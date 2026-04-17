# ConsentFlow — Frontend Reference

> **Stack:** Next.js 16.2 (App Router) · React 19 · TypeScript · TailwindCSS v4  
> **Base URL (proxy):** `/api` → `http://localhost:8000` via Next.js API routes  
> **Dev port:** `3001` (`npm run dev`)  
> **Auth approach:** `X-User-ID` header injected automatically from `sessionStorage` by Axios interceptor

---

## 1. Quick Reference

| Item | Value |
|------|-------|
| Framework | Next.js 16.2 (App Router) |
| React | 19.2.4 |
| Language | TypeScript 5 |
| Styling | TailwindCSS v4 + custom CSS modules per page |
| State/data | TanStack Query v5 (`@tanstack/react-query`) |
| HTTP client | Axios (via `lib/axios.ts` singleton) |
| Animation | Framer Motion 12 + GSAP 3 |
| API proxy | Next.js `app/api/` route handlers forward to FastAPI |

---

## 2. All 8 Pages

### 2.1 Landing Page — `/`

**Route:** `app/page.tsx`  
**Status:** ✅ Built

**Purpose:** Marketing/introduction page showing the ConsentFlow architecture, the four gates explanation, tech stack pills, and links to the dashboard.

**API calls:** None (static content)

**Components used:**
- `Navbar` (`components/layout/Navbar`)
- `AnimatedBeam` (`components/magicui/animated-beam`) — animated flow diagram
- Framer Motion `motion.div` for stagger animations
- GSAP IntersectionObserver for flow node entrance animation

**Error states:** None (no API calls)

**Key implementation notes:**
- `handleMouseMove` updates CSS custom properties `--mx`/`--my` for card spotlight effect
- GSAP context is cleaned up on unmount via `ctx.revert()`
- AnimatedBeam arrows use labeled gradients (`#7c6dfa` purple → `#3ecfb2` teal)

---

### 2.2 Dashboard — `/dashboard`

**Route:** `app/dashboard/page.tsx`  
**Status:** ✅ Built

**Purpose:** Real-time system overview — metric cards, gate status tiles, audit event table, health widget, consent-by-purpose bars, and 24-hour inference sparkline.

**API calls:**
| Method | Endpoint | Interval | Purpose |
|--------|----------|----------|---------|
| GET | `/api/health` | 10 s (polling) | Backend liveness |
| GET | `/api/dashboard-stats` | On health success | Metric aggregates |
| GET | `/api/audit?limit=8` | 15 s (polling via `useAuditTrail`) | Recent events table |

**Components used:**
- `Sidebar` (`components/layout/Sidebar`)
- `MetricCard` (`components/dashboard/MetricCard`)
- `HealthWidget` (`components/dashboard/HealthWidget`)
- `useAuditTrail` hook (15 s refetch)

**Error states:**
- Backend offline → badge shows "Backend Offline" (clickable to retry); audit table shows empty state
- API call failure → silently ignored; existing state preserved

**Key implementation notes:**
- `sec` counter ticks every second to show "Updated Xs ago" in the topbar badge
- Gate cards (Dataset, Training, Inference, Drift) show **static** demo numbers — only the metric cards and audit table pull live data
- **Gate 05 card** (shield icon, "Policies Scanned") shows live `policy_scans_total`; if `policy_scans_critical > 0`, sub-label renders in red. Clicking navigates to `/policy`
- `sessionStorage('active_user_id')` is read by the Axios interceptor but not set on this page

---

### 2.8 Policy Auditor — `/policy`

**Route:** `app/policy/page.tsx`  
**Status:** ✅ Built

**Purpose:** Gate 05 — LLM-powered ToS / privacy policy scanner. Accepts a URL or pasted text, calls `POST /policy/scan`, renders a risk-level banner and per-finding expandable cards. Lists past scans via `GET /policy/scans`.

**API calls:**
| Method | Endpoint | When | Purpose |
|--------|----------|------|---------|
| POST | `/api/policy` (scan) | Scan button click | Submit policy for analysis |
| GET | `/api/policy` (scans) | Page load | Load scan history |

**Hooks used:** `usePolicyAuditor` (`hooks/usePolicyAuditor.ts`) — `useScanPolicy` mutation + `usePolicyScans` query

**Components used:**
- `Sidebar`
- Risk level banner (green=low, amber=medium, red=high, red+pulse=critical)
- Per-finding cards: severity badge, clause excerpt, plain-English explanation, GDPR/CCPA article ref
- Scan history table

**Error states:**
- 503 → "ANTHROPIC_API_KEY not configured on this server"
- 422 → "Could not fetch policy URL" (unreachable URL)
- 502 → "LLM analysis failed" (Claude API error)
- Empty history → "No scans yet" placeholder

**Key implementation notes:**
- `integration_name` field required; `policy_url` OR `policy_text` required (validated before submit)
- `overall_risk_level` is the highest severity across all findings
- Each finding has: `severity` (low/medium/high/critical), `category`, `clause_excerpt`, `explanation`, `article_reference`

---

### 2.3 Users — `/users`

**Route:** `app/users/page.tsx`  
**Status:** ✅ Built

**Purpose:** User registry — list all users, search, register new, view individual consent records, and set as "active user" in sessionStorage for inference testing.

**API calls:**
| Method | Endpoint | When | Purpose |
|--------|----------|------|---------|
| GET | `/api/users` | Page load + poll | User list |
| POST | `/api/users/register` | Form submit | Create user |
| GET | `/api/users/{user_id}` | Row click | User detail |
| GET | `/api/consent/{user_id}/{purpose}` | Detail view | Consent status |

**Components used:**
- `Sidebar`
- `UserSearchBar` (inline, not extracted)
- Consent status badges (inline pill elements)

**Error states:**
- 409 on duplicate email → inline "Email already registered" error
- Empty list → "No users found" placeholder
- Network error → error toast via `api:error` custom event

**Key implementation notes:**
- Clicking "Set as active" stores UUID in `sessionStorage('active_user_id')`, which the Axios interceptor picks up for `/infer` calls
- Consent badges use purpose-filtered API calls; empty state shows "pending"

---

### 2.4 Consent Manager — `/consent`

**Route:** `app/consent/page.tsx`  
**Status:** ✅ Built

**Purpose:** Grant or revoke consent records. Includes a record list, filter by user/purpose/status, and a create/update form.

**API calls:**
| Method | Endpoint | When | Purpose |
|--------|----------|------|---------|
| GET | `/api/consent` | Page load + poll | All consent records |
| POST | `/api/consent` | Form submit | Grant/revoke consent |
| POST | `/api/consent/revoke` | Quick revoke button | Revoke by user+purpose |

**Components used:**
- `Sidebar`
- `ConsentForm` (inline)
- `ConsentStatusBadge` (inline pill)

**Error states:**
- 404 for unknown user (FK violation) → inline toast "User not found"
- 422 validation errors → field-level error messages
- Empty records list → "No records yet" state

**Key implementation notes:**
- The form uses `user_id` (UUID) + `data_type` + `purpose` + `status`; all are required
- Records are ordered by `updated_at DESC`; most recent 1000 fetched

---

### 2.5 Audit Trail — `/audit`

**Route:** `app/audit/page.tsx`  
**Status:** ✅ Built

**Purpose:** Full audit trail viewer with filters (user_id, gate_name), pagination via limit, and trace ID linkable to Grafana/Jaeger.

**API calls:**
| Method | Endpoint | When | Purpose |
|--------|----------|------|---------|
| GET | `/api/audit?limit=N&user_id=X&gate_name=Y` | Page load + filter change | Audit entries |

**Components used:**
- `Sidebar`
- `AuditTable` (inline table)
- Filter dropdowns and search input

**Error states:**
- Empty result → "No audit entries found" with hint to run gates
- Loading state → skeleton rows

**Key implementation notes:**
- Gate name filter values: `dataset_gate`, `inference_gate`, `training_gate`, `monitoring_gate`, `policy_auditor`
- `action_taken` values from the DB: `passed`, `blocked`, `anonymized`, `quarantined`, `alerted`, `scanned`
- `metadata` JSONB parsed and rendered as a code block when non-null
- `trace_id` is displayed as a hex string; no deep-link implemented yet

---

### 2.6 Webhook Simulator — `/webhook`

**Route:** `app/webhook/page.tsx`  
**Status:** ✅ Built

**Purpose:** Interactive OneTrust webhook payload editor. Sends `POST /webhook/consent-revoke` and shows the raw response JSON with `kafka_published` status.

**API calls:**
| Method | Endpoint | When | Purpose |
|--------|----------|------|---------|
| POST | `/api/webhook` | Simulate button | Trigger consent revocation |

**Components used:**
- `Sidebar`
- `WebhookPayloadEditor` (inline editable JSON textarea)
- Propagation status indicators (DB, Cache, Kafka columns)

**Error states:**
- 422 if `consentStatus` ≠ `"revoked"` → inline error
- 207 → green DB+Cache, red Kafka, yellow warning message
- Network error → error state with full response body

**Key implementation notes:**
- Payload must have camelCase fields: `userId`, `purpose`, `consentStatus`, `timestamp`
- History of past simulations is shown below the editor (in-memory, resets on page load)
- Default payload pre-filled with demo UUID `550e8400-e29b-41d4-a716-446655440000`

---

### 2.7 Inference Tester — `/infer`

**Route:** `app/infer/page.tsx`  
**Status:** ✅ Built

**Purpose:** Live test of the `ConsentMiddleware`. Enter a UUID and prompt, fires `POST /infer/predict`; shows allowed/blocked/error state.

**API calls:**
| Method | Endpoint | When | Purpose |
|--------|----------|------|---------|
| POST | `/api/infer` | "Fire" button | Test inference gate |

**Components used:**
- `Sidebar`
- UUID input + prompt textarea
- Result badge (green allowed / red blocked / yellow error / grey unavailable)

**Error states:**
- `400` → "Missing or invalid user ID"
- `403` → Red "Blocked — consent revoked" with middleware explanation
- `422` → "Missing or invalid user ID"
- `503` → "Consent engine unavailable" (backend down)

**Key implementation notes:**
- UUID validated client-side with `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` before sending
- `sessionStorage('active_user_id')` auto-fills the UUID field on mount
- `X-User-ID` header is set explicitly on this request (overrides the interceptor value)
- Request goes to `/api/infer` (Next.js proxy) → `POST /infer/predict` on FastAPI

---

## 3. TypeScript Interfaces

These match the Pydantic response models exactly.

```typescript
// GET /health
interface HealthResponse {
  status: "ok" | "degraded" | "error";
  postgres: string;        // "ok" | "error: <message>"
  redis: string;           // "ok" | "error: <message>"
}

// GET /users, GET /users/{user_id}
interface UserListRecord {
  id: string;              // UUID
  email: string;
  created_at: string;      // ISO-8601
  consents: number;        // total consent record count
  status: "active" | "revoked" | "pending";
}

// POST /users, POST /users/register
interface UserRecord {
  id: string;              // UUID
  email: string;
  created_at: string;      // ISO-8601
}

// GET /consent, POST /consent, POST /consent/revoke
interface ConsentRecord {
  id: string;              // UUID
  user_id: string;         // UUID
  data_type: string;
  purpose: string;
  status: "granted" | "revoked";
  updated_at: string;      // ISO-8601
}

// GET /consent/{user_id}/{purpose}
interface ConsentStatusResponse {
  user_id: string;         // UUID
  purpose: string;
  status: "granted" | "revoked";
  updated_at: string;      // ISO-8601
  cached: boolean;
}

// POST /webhook/consent-revoke
interface WebhookRevokeResponse {
  status: "propagated" | "partial";
  user_id: string;
  purpose: string;
  kafka_published: boolean;
  warning: string | null;
}

// POST /infer/predict (when allowed)
interface InferResponse {
  status: "success";
  message: string;
  user_id: string | null;
  prediction: string;
}

// GET /audit/trail
interface AuditEntry {
  id: string;              // UUID
  event_time: string;      // ISO-8601
  user_id: string;         // TEXT (may be "UNKNOWN")
  gate_name: string;       // "dataset_gate" | "inference_gate" | "training_gate" | "monitoring_gate"
  action_taken: string;    // "passed" | "blocked" | "anonymized" | "quarantined" | "alerted"
  consent_status: string;  // "granted" | "revoked"
  purpose: string | null;
  metadata: Record<string, unknown> | null;
  trace_id: string | null; // OTel W3C trace ID hex
}

interface AuditTrailResponse {
  entries: AuditEntry[];
  total: number;
}

// GET /dashboard/stats
interface DashboardStatsResponse {
  users: number;
  granted: number;
  blocked: number;
  purposes: Record<string, number>;  // e.g. { "analytics": 20, "inference": 15 }
  checks_24h_total: number;
  checks_24h_allowed: number;
  checks_24h_blocked: number;
  checks_sparkline: number[];        // 24 integers, index 0 = oldest hour
  // Gate 05 — added v0.3.0
  policy_scans_total: number;
  policy_scans_critical: number;
}

// POST /policy/scan — Gate 05
interface PolicyFinding {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  clause_excerpt: string;
  explanation: string;
  article_reference: string;
}

interface PolicyScanRequest {
  integration_name: string;
  policy_url?: string;
  policy_text?: string;  // at least one of policy_url or policy_text required
}

interface PolicyScanResult {
  scan_id: string;           // UUID
  integration_name: string;
  overall_risk_level: "low" | "medium" | "high" | "critical";
  findings: PolicyFinding[];
  findings_count: number;
  raw_summary: string;
  scanned_at: string;        // ISO-8601
  policy_url: string | null;
}

// GET /policy/scans
interface PolicyScanListItem {
  scan_id: string;           // UUID
  integration_name: string;
  overall_risk_level: string;
  findings_count: number;
  scanned_at: string;        // ISO-8601
}
```

---

## 4. Reusable Component Specs

### 4.1 `ConsentStatusBadge`
**Location:** Inline in `/consent` and `/users` pages (not extracted to a file yet)  
**Props:** `status: "granted" | "revoked" | "pending"`  
**Behavior:** Renders a colored pill. Green = granted, red = revoked, grey = pending.  
**Edge cases:** Handles undefined status gracefully (shows "pending").

### 4.2 `UserSearchBar`
**Location:** Inline in `/users`  
**Props:** `value: string`, `onChange: (v: string) => void`  
**Behavior:** Client-side filter on the fetched user list by email prefix.  
**Edge cases:** Empty search shows all users; no debounce (real-time filter).

### 4.3 `ConsentForm`
**Location:** Inline in `/consent`  
**Props:** Controlled — form state managed by parent page  
**Fields:** `user_id` (UUID), `data_type` (string), `purpose` (string), `status` (select)  
**Behavior:** Submits `POST /api/consent`; clears form on success; shows inline error on failure.  
**Edge cases:** Validates UUID format before submit; disables submit while loading.

### 4.4 `AuditTable`
**Location:** Inline in `/audit` and abbreviated version in `/dashboard`  
**Props:** `entries: AuditEntry[]`, `loading: boolean`  
**Behavior:** Renders rows sorted newest-first. Color-codes `action_taken` (green=passed/allow, red=blocked/anonymized).  
**Edge cases:** Empty state with hint message; skeleton rows while loading.

### 4.5 `HealthWidget`
**Location:** `components/dashboard/HealthWidget.tsx`  
**Props:** None (fetches independently)  
**Behavior:** Calls `GET /api/health`; shows three status indicators: overall, postgres, redis.  
**Edge cases:** Shows error state if backend unreachable; retries on mount.

### 4.6 `WebhookPayloadEditor`
**Location:** Inline in `/webhook`  
**Props:** Controlled — managed by page state  
**Behavior:** Editable JSON textarea pre-filled with OneTrust payload template. Validates JSON before submit.  
**Edge cases:** Invalid JSON → shows parse error inline; won't submit invalid JSON.

### 4.7 `GateDecisionCard`
**Location:** Inline inline tiles in `/dashboard`  
**Props:** `name: string`, `stat: number`, `label: string`, `color: "purple"|"teal"|"coral"|"amber"`  
**Behavior:** Shows gate name, a metric value, and descriptive label.  
**Edge cases:** Currently shows static demo data for Dataset/Training/Drift gates; Inference gate shows live blocked count from dashboard stats.

### 4.8 `ConsentMatrix`
**Location:** "Consent by purpose" bars in `/dashboard`  
**Props:** `purposes: Record<string, number>`, `totalUsers: number`  
**Behavior:** Renders horizontal progress bars for each purpose key, scaled as % of total users.  
**Edge cases:** Division by zero when `users=0` — shows 0% for all bars.

---

## 5. Error Handling Table

| HTTP Code | UI Treatment |
|-----------|-------------|
| 200 | Success — render data |
| 201 | Success — show confirmation toast, refresh list |
| 207 | Partial success — warn "Kafka publish failed", show yellow warning badge |
| 400 | Show inline error: "Missing or invalid user ID" |
| 403 | Inference blocked — red "Blocked — consent revoked" result card |
| 404 | Inline error: "Not found" (user or consent record) |
| 409 | Email conflict — inline "Email already registered" |
| 422 | Field validation error — highlight affected fields |
| 500 | Toast (via `api:error` event): "Server error — try again" |
| 503 | Toast (via `api:error` event): "Consent engine unavailable"; inference page shows grey "unavailable" card |

---

## 6. Polling Strategy

| Page | Endpoint | Interval | Mechanism |
|------|----------|----------|-----------|
| Dashboard | `/api/health` | 10 s | `setInterval` in `useEffect` |
| Dashboard | `/api/audit?limit=8` | 15 s | TanStack Query `refetchInterval` |
| Dashboard | `/api/dashboard-stats` | On health poll | Called inside `checkHealth()` |
| Audit | `/api/audit` | Manual (filters) | TanStack Query, no auto-refetch |
| Users | `/api/users` | Manual | TanStack Query, no auto-refetch |
| Policy | `/api/policy` (GET scans) | On mount | TanStack Query, no auto-refetch |

> **Design decision:** Only the dashboard auto-polls. All other pages fetch on mount and on manual interaction (filter change, form submit, refresh button).

---

## 7. Design System Tokens

Defined in `app/globals.css` and per-page CSS files (`app/dashboard/css/dashboard.css`, etc.):

```css
/* Core palette */
--bg:          #0a0a0f;     /* Page background */
--surface:     #111118;     /* Card background */
--surface2:    #18181f;     /* Input / table row */
--border:      rgba(255,255,255,0.06);
--border2:     rgba(255,255,255,0.10);

/* Brand accent colors */
--accent:      #7c6dfa;     /* Purple — dataset gate, primary CTAs */
--accent2:     #3ecfb2;     /* Teal — training gate, success states */
--accent3:     #fa6d8a;     /* Coral/Red — inference gate, blocked states */
--amber:       #f5a623;     /* Amber/Yellow — drift monitor, warnings */

/* Text */
--text:        rgba(255,255,255,0.92);
--muted:       rgba(255,255,255,0.45);
--muted2:      rgba(255,255,255,0.25);

/* Typography */
--font-display: 'Geist Sans', system-ui;
--font-mono:    'Geist Mono', monospace;

/* Status pill colors */
.pill.allow  { color: #3ecfb2; background: rgba(62,207,178,0.12); }
.pill.block  { color: #fa6d8a; background: rgba(250,109,138,0.12); }
```

---

## 8. Build Phases (Dependency Order)

1. **Layout + Sidebar** — `components/layout/Sidebar.tsx`, `Navbar.tsx`
2. **Axios + types** — `lib/axios.ts`, `types/api.ts`
3. **Query Provider** — `components/providers/QueryProvider.tsx`
4. **Landing page** — `app/page.tsx` + `app/css/landing.css`
5. **Dashboard** — `app/dashboard/page.tsx`, `MetricCard`, `HealthWidget`
6. **Users page** — `app/users/page.tsx`
7. **Consent page** — `app/consent/page.tsx`
8. **Audit page** — `app/audit/page.tsx`
9. **Webhook page** — `app/webhook/page.tsx`
10. **Infer page** — `app/infer/page.tsx`
11. **Policy Auditor page** — `app/policy/page.tsx`, `hooks/usePolicyAuditor.ts`
12. **API proxy routes** — `app/api/*/route.ts` for each backend endpoint (including `/api/policy`)

---

## 9. Demo Script (2-minute Hackathon Flow)

Use this sequence to demo ConsentFlow end-to-end from the UI:

1. **Open** `http://localhost:3001` — landing page with animated flow diagram
2. **Navigate** to `/dashboard` — show live metrics (users, consents, blocked, policies scanned)
3. **Navigate** to `/users` — show demo user, click "Set as active"
4. **Navigate** to `/infer` — UUID auto-filled; hit "Fire /infer/predict" → **green Allowed**
5. **Navigate** to `/webhook` — pre-filled payload; hit "Simulate Revocation" → propagated ✓
6. **Navigate** back to `/infer` — hit "Fire /infer/predict" → **red Blocked (403)**
7. **Navigate** to `/dashboard` — `blocked` counter incremented; audit table shows new block event
8. **Navigate** to `/audit` — full trail with `action_taken: blocked`, `gate_name: inference_gate`
9. **Navigate** to `/policy` — paste a real AI plugin ToS URL; click "Scan for Risks" → Claude returns findings in ~5 s; risk banner shows **CRITICAL** with clause excerpts and GDPR article refs

Total: ~2 minutes. Key moments: step 4 → 6 shows revocation propagating in real time; step 9 shows LLM-powered policy bypass detection.
