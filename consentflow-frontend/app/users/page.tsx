"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import "./css/user.css";
import api from "@/lib/axios";

/* ────────── Types ────────── */
interface User {
  id: string;
  email: string;
  created_at: string;
  /**
   * Derived by the backend: count of all consent_records for this user.
   * Always present when fetched from GET /users or GET /users/{id}.
   */
  consents: number;
  /**
   * Derived by the backend:
   *   'active'  — at least one granted consent
   *   'revoked' — all consents revoked
   *   'pending' — no consents yet
   */
  status: "active" | "revoked" | "pending";
}

interface Stats {
  total: number;
  active: number;
  revoked: number;
}

/* ────────── UUID regex ────────── */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

/* ────────── SVG icon helpers ────────── */
const IconInfo = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);
const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconX = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/* ────────── Status badge ─ module-scope to avoid remounting on every render ── */
function StatusBadge({ status }: { status?: string }) {
  const s = status ?? "active";
  const cls = s === "active" ? "status-active" : s === "revoked" ? "status-revoked" : "status-pending";
  const dotColor = s === "active" ? "var(--accent2)" : s === "revoked" ? "var(--accent3)" : "var(--amber)";
  return (
    <span className={`status-badge ${cls}`}>
      <span className="status-dot" style={{ background: dotColor }} />
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </span>
  );
}

/* ────────── Main page ────────── */
export default function UsersPage() {
  const router = useRouter();

  /* ── State ── */
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, revoked: 0 });
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [tableError, setTableError] = useState<string | null>(null);

  // Register panel
  const [regEmail, setRegEmail] = useState("");
  const [regEmailState, setRegEmailState] = useState<"idle" | "valid" | "error">("idle");
  const [regLoading, setRegLoading] = useState(false);
  const [regResult, setRegResult] = useState<User | null>(null);
  const [regError, setRegError] = useState<{ code: string; msg: string } | null>(null);

  // Lookup panel
  const [lookupUUID, setLookupUUID] = useState("");
  const [lookupUUIDState, setLookupUUIDState] = useState<"idle" | "valid" | "error">("idle");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<User | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Filter / search
  const [searchQuery, setSearchQuery] = useState("");

  /* ────────── Fetch all users ────────── */
  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    setTableError(null);
    try {
      // GET /users returns UserListRecord[] — includes consents count and derived status
      const res = await api.get<User[]>("/users");
      const data = res.data;
      setUsers(data);
      setFilteredUsers(data);
      const active  = data.filter((u) => u.status === "active").length;
      const revoked = data.filter((u) => u.status === "revoked").length;
      setStats({ total: data.length, active, revoked });
    } catch (err: any) {
      // Only fall back to demo data when the backend is genuinely unreachable
      // (network error, CORS, no response). For API errors (4xx/5xx) surface the
      // real problem so it's visible rather than silently swapping to fake data.
      const isNetworkError = !err?.response; // no response = connection refused / offline

      if (isNetworkError) {
        const DEMO: User[] = [
          { id: "550e8400-e29b-41d4-a716-446655440000", email: "alice@example.com",  created_at: "2026-04-01T09:12:44Z", consents: 3, status: "active" },
          { id: "a3f2c1d0-4b5e-6f7a-8b9c-0d1e2f3a4b5c", email: "bob@acme.io",        created_at: "2026-04-03T14:35:00Z", consents: 2, status: "active" },
          { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", email: "carol@data.co",       created_at: "2026-04-05T11:22:17Z", consents: 1, status: "revoked" },
          { id: "c56a4180-65aa-42ec-a945-5fd21dec0538", email: "dan@ml.dev",          created_at: "2026-04-07T16:44:55Z", consents: 4, status: "active" },
          { id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", email: "eve@research.ai",     created_at: "2026-04-09T08:05:33Z", consents: 2, status: "active" },
          { id: "6ba7b811-9dad-11d1-80b4-00c04fd430c8", email: "frank@startup.io",    created_at: "2026-04-10T19:01:12Z", consents: 0, status: "pending" },
          { id: "6ba7b812-9dad-11d1-80b4-00c04fd430c8", email: "grace@lab.com",       created_at: "2026-04-11T13:50:09Z", consents: 3, status: "active" },
        ];
        setUsers(DEMO);
        setFilteredUsers(DEMO);
        const active  = DEMO.filter((u) => u.status === "active").length;
        const revoked = DEMO.filter((u) => u.status === "revoked").length;
        setStats({ total: DEMO.length, active, revoked });
        setTableError("Backend offline — showing demo data");
      } else {
        // Backend responded but with an error — show real error, keep table empty
        const httpStatus = err.response?.status ?? "?";
        const detail     = err.response?.data?.detail ?? err.message ?? "Unknown error";
        setTableError(`API error ${httpStatus}: ${detail}`);
        setUsers([]);
        setFilteredUsers([]);
      }
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  /* ────────── Filter table ────────── */
  useEffect(() => {
    const q = searchQuery.toLowerCase();
    setFilteredUsers(
      q ? users.filter((u) => u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q)) : users
    );
  }, [searchQuery, users]);

  /* ────────── Email validation ────────── */
  const validateEmail = (val: string) => {
    if (!val) { setRegEmailState("idle"); return; }
    setRegEmailState(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? "valid" : "error");
  };

  /* ────────── UUID validation ────────── */
  const validateUUID = (val: string) => {
    if (!val) { setLookupUUIDState("idle"); return; }
    setLookupUUIDState(UUID_RE.test(val) ? "valid" : "error");
  };

  /* ────────── Register user ────────── */
  const registerUser = async () => {
    if (regEmailState !== "valid") { setRegEmailState("error"); return; }
    setRegLoading(true);
    setRegResult(null);
    setRegError(null);
    try {
      // POST /users/register — backend alias that returns UserRecord (id, email, created_at)
      // New users have no consents yet, so status starts as 'pending'
      const res = await api.post<{ id: string; email: string; created_at: string }>(
        "/users/register",
        { email: regEmail },
      );
      const newUser: User = { ...res.data, consents: 0, status: "pending" };
      setRegResult(newUser);
      setUsers((prev) => [newUser, ...prev]);
      setStats((s) => ({ ...s, total: s.total + 1 }));
      setRegEmail("");
      setRegEmailState("idle");
    } catch (err: any) {
      const httpStatus = err?.response?.status ?? 500;
      const detail     = err?.response?.data?.detail ?? "Registration failed";
      if (httpStatus === 409) {
        setRegError({ code: "409 CONFLICT", msg: "This email is already registered" });
      } else {
        setRegError({ code: `${httpStatus} ERROR`, msg: String(detail) });
      }
    } finally {
      setRegLoading(false);
    }
  };

  /* ────────── Lookup user ────────── */
  const lookupUser = async () => {
    if (lookupUUIDState !== "valid") { setLookupUUIDState("error"); return; }
    setLookupLoading(true);
    setLookupResult(null);
    setLookupError(null);
    try {
      // GET /users/{id} now returns UserListRecord (includes consents + status)
      const res = await api.get<User>(`/users/${lookupUUID.trim()}`);
      setLookupResult(res.data);
    } catch (err: any) {
      const httpStatus = err?.response?.status ?? 500;
      if (httpStatus === 404) {
        setLookupError("No user found with this UUID. Check the ID and try again.");
      } else {
        setLookupError(`Request failed (${httpStatus}) — is the backend running?`);
      }
    } finally {
      setLookupLoading(false);
    }
  };

  /* ────────── Click row → populate lookup ────────── */
  const loadRow = (u: User) => {
    setLookupUUID(u.id);
    setLookupUUIDState("valid");
    setLookupResult(u);
    setLookupError(null);
  };

  /* ────────── Load demo UUID ────────── */
  const loadDemo = () => {
    const demo = users[0];
    if (demo) loadRow(demo);
  };

  /* ────────── Copy to clipboard ────────── */
  const copyText = (text: string, btnId: string) => {
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.textContent = "Copied!";
        (btn as HTMLButtonElement).style.color = "var(--accent2)";
        setTimeout(() => {
          btn.textContent = "Copy";
          (btn as HTMLButtonElement).style.color = "";
        }, 1500);
      }
    });
  };

  /* ────────── Export CSV ────────── */
  const exportCSV = () => {
    const rows = [
      ["UUID", "Email", "Created", "Status"],
      ...users.map((u) => [u.id, u.email, u.created_at, u.status ?? "active"]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv," + encodeURIComponent(csv);
    a.download = "consentflow-users.csv";
    a.click();
  };

  /* ────────── Go to consent page ────────── */
  const gotoConsent = () => {
    if (lookupResult) {
      sessionStorage.setItem("active_user_id", lookupResult.id);
      router.push("/consent");
    }
  };


  return (
    <>
      {/* Background mesh */}
      <div className="mesh" />

      <div className="layout">
        {/* ── Sidebar ── */}
        <Sidebar />

        {/* ── Main ── */}
        <main className="main">

          {/* ── Topbar ── */}
          <div className="topbar fade1">
            <div>
              <h1 className="page-title">User Management</h1>
              <p className="page-sub">Register, look up, and browse consent-backed identities</p>
            </div>
            <div className="topbar-right">
              <button
                className="btn"
                onClick={exportCSV}
                title="Export all users as CSV"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export CSV
              </button>
              <button
                className="btn primary"
                onClick={() => document.getElementById("reg-email")?.focus()}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Register User
              </button>
            </div>
          </div>

          {/* ── Stats row ── */}
          <div className="stats-row fade2">
            <div className="stat-mini">
              <div className="stat-mini-val accent">{stats.total.toLocaleString()}</div>
              <div className="stat-mini-label">Total registered</div>
            </div>
            <div className="stat-mini">
              <div className="stat-mini-val teal">{stats.active.toLocaleString()}</div>
              <div className="stat-mini-label">With active consent</div>
            </div>
            <div className="stat-mini">
              <div className="stat-mini-val coral">{stats.revoked.toLocaleString()}</div>
              <div className="stat-mini-label">Consent revoked</div>
            </div>
          </div>

          {/* ── Two-column panels ── */}
          <div className="content-grid fade3">

            {/* ─── Register User Panel ─── */}
            <div className="panel" id="register-panel">
              <div className="panel-header">
                <div className="panel-icon purple">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <line x1="20" y1="8" x2="20" y2="14" />
                    <line x1="23" y1="11" x2="17" y2="11" />
                  </svg>
                </div>
                <div>
                  <div className="panel-title">Register New User</div>
                  <div className="panel-sub">Creates a UUID-backed identity via the API</div>
                </div>
              </div>

              <div className="panel-body">
                <div className="notice info">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  The returned UUID is your identity token. Copy it immediately — you&apos;ll need it for consent grants and inference calls.
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="reg-email">Email address</label>
                  <input
                    id="reg-email"
                    type="email"
                    placeholder="alice@example.com"
                    value={regEmail}
                    className={regEmailState === "error" ? "error" : regEmailState === "valid" ? "valid" : ""}
                    onChange={(e) => { setRegEmail(e.target.value); validateEmail(e.target.value); }}
                    onKeyDown={(e) => { if (e.key === "Enter") registerUser(); }}
                  />
                  <div className={`field-hint ${regEmailState === "error" ? "error" : regEmailState === "valid" ? "success" : "info"}`}>
                    {regEmailState === "error" ? <><IconX /> Enter a valid email address</> :
                     regEmailState === "valid" ? <><IconCheck /> Valid email format</> :
                     <><IconInfo /> Used as the account identifier — must be unique</>}
                  </div>
                </div>

                <button
                  className="btn primary"
                  style={{ width: "100%", justifyContent: "center", padding: "10px" }}
                  onClick={registerUser}
                  disabled={regLoading}
                >
                  {regLoading ? <span className="spinner" /> : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="8.5" cy="7" r="4" />
                      <line x1="20" y1="8" x2="20" y2="14" />
                      <line x1="23" y1="11" x2="17" y2="11" />
                    </svg>
                  )}
                  {regLoading ? "Registering…" : "Register User"}
                </button>

                {/* Success */}
                {regResult && (
                  <div className="result-card success show">
                    <div className="result-header">
                      <span className="result-badge badge-success">✓ REGISTERED</span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>User created successfully</span>
                    </div>
                    <div className="result-grid">
                      <div>
                        <div className="result-field-label">Email</div>
                        <div className="result-field-value">{regResult.email}</div>
                      </div>
                      <div>
                        <div className="result-field-label">Created</div>
                        <div className="result-field-value">
                          {new Date(regResult.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </div>
                      </div>
                      <div className="uuid-display">
                        <div>
                          <div className="uuid-label">User UUID — copy for API calls</div>
                          <div className="uuid-value" id="reg-uuid-val">{regResult.id}</div>
                        </div>
                        <button
                          id="reg-copy-btn"
                          className="copy-btn"
                          onClick={() => copyText(regResult.id, "reg-copy-btn")}
                        >
                          Copy
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Error */}
                {regError && (
                  <div className="result-card error-card show">
                    <div className="result-header">
                      <span className="result-badge badge-error">{regError.code}</span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>{regError.msg}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ─── Look Up User Panel ─── */}
            <div className="panel">
              <div className="panel-header">
                <div className="panel-icon teal">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <div>
                  <div className="panel-title">Look Up User</div>
                  <div className="panel-sub">Fetch profile by UUID from the API</div>
                </div>
              </div>

              <div className="panel-body">
                <div className="field">
                  <label className="field-label" htmlFor="lookup-uuid">User UUID</label>
                  <div className="input-wrap" style={{ width: "100%" }}>
                    <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      id="lookup-uuid"
                      type="text"
                      placeholder="550e8400-e29b-41d4-a716-446655440000"
                      value={lookupUUID}
                      className={lookupUUIDState === "error" ? "error" : lookupUUIDState === "valid" ? "valid" : ""}
                      onChange={(e) => { setLookupUUID(e.target.value); validateUUID(e.target.value); }}
                      onKeyDown={(e) => { if (e.key === "Enter") lookupUser(); }}
                    />
                  </div>
                  <div className={`field-hint ${lookupUUIDState === "error" ? "error" : lookupUUIDState === "valid" ? "success" : "info"}`}>
                    {lookupUUIDState === "error" ? <><IconX /> Invalid UUID — must be xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</> :
                     lookupUUIDState === "valid" ? <><IconCheck /> Valid UUID format</> :
                     <><IconInfo /> Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</>}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    className="btn primary"
                    style={{ flex: 1, justifyContent: "center" }}
                    onClick={lookupUser}
                    disabled={lookupLoading}
                  >
                    {lookupLoading ? <span className="spinner" /> : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    )}
                    {lookupLoading ? "Fetching…" : "Fetch User"}
                  </button>
                  <button className="btn" onClick={loadDemo}>Demo UUID</button>
                </div>

                {/* User detail result */}
                {lookupResult && (
                  <div className="result-card success show">
                    <div className="user-detail-header">
                      <div className="user-avatar">
                        {lookupResult.email.split("@")[0].slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="user-name">{lookupResult.email}</div>
                        <div className="user-email">Registered user</div>
                      </div>
                    </div>
                    <table className="detail-table">
                      <tbody>
                        <tr>
                          <td>UUID</td>
                          <td style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--accent)" }}>
                            {lookupResult.id}
                          </td>
                        </tr>
                        <tr>
                          <td>Email</td>
                          <td>{lookupResult.email}</td>
                        </tr>
                        <tr>
                          <td>Created</td>
                          <td>{new Date(lookupResult.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                        </tr>
                        <tr>
                          <td>Status</td>
                          <td><StatusBadge status={lookupResult.status} /></td>
                        </tr>
                      </tbody>
                    </table>
                    <div style={{ marginTop: "14px", display: "flex", gap: "8px" }}>
                      <button
                        id="lookup-copy-btn"
                        className="btn"
                        style={{ flex: 1, fontSize: "12px", justifyContent: "center" }}
                        onClick={() => copyText(lookupResult.id, "lookup-copy-btn")}
                      >
                        <svg style={{ width: 12, height: 12 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy UUID
                      </button>
                      <button
                        className="btn"
                        style={{ flex: 1, fontSize: "12px", justifyContent: "center", color: "var(--accent2)" }}
                        onClick={gotoConsent}
                      >
                        View Consents →
                      </button>
                    </div>
                  </div>
                )}

                {/* 404 / error */}
                {lookupError && (
                  <div className="result-card error-card show">
                    <div className="result-header">
                      <span className="result-badge badge-error">NOT FOUND</span>
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--muted)" }}>{lookupError}</div>
                  </div>
                )}
              </div>
            </div>

            {/* ─── Recent Users Table (full width) ─── */}
            <div className="panel full-width fade4">
              <div className="panel-header" style={{ justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="panel-icon purple">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <div>
                    <div className="panel-title">Recent Users</div>
                    <div className="panel-sub">Latest registrations — click a row to inspect</div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {tableError && (
                    <span style={{ fontSize: 11, color: "var(--amber)", background: "var(--amber-dim)", border: "1px solid rgba(245,166,35,0.2)", padding: "3px 10px", borderRadius: 20 }}>
                      ⚠ {tableError}
                    </span>
                  )}
                  <div className="input-wrap" style={{ width: 220 }}>
                    <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Filter users…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{ fontSize: "13px", padding: "7px 13px 7px 34px" }}
                    />
                  </div>
                  <button className="btn" onClick={fetchUsers} title="Refresh from API">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}>
                      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                    Refresh
                  </button>
                </div>
              </div>

              <div className="users-table-wrap">
                {loadingUsers ? (
                  <div style={{ padding: "2rem 1.25rem", display: "flex", flexDirection: "column", gap: 10 }}>
                    {[85, 70, 90, 65, 80].map((w, i) => (
                      <div key={i} className="shimmer" style={{ height: 18, width: `${w}%` }} />
                    ))}
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                      </svg>
                    </div>
                    <p>No users found{searchQuery ? ` matching "${searchQuery}"` : ""}</p>
                  </div>
                ) : (
                  <table className="user-table" id="users-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>UUID</th>
                        <th>Registered</th>
                        <th>Consents</th>
                        <th>Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => {
                        const initials = u.email.split("@")[0].slice(0, 2).toUpperCase();
                        return (
                          <tr key={u.id} onClick={() => loadRow(u)}>
                            <td>
                              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                                <div style={{
                                  width: 30, height: 30, borderRadius: 8,
                                  background: "linear-gradient(135deg,var(--accent),var(--accent2))",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  fontSize: 11, fontWeight: 600, color: "#fff", flexShrink: 0,
                                }}>
                                  {initials}
                                </div>
                                <span>{u.email}</span>
                              </div>
                            </td>
                            <td className="mono">{u.id.slice(0, 8)}…{u.id.slice(-4)}</td>
                            <td style={{ color: "var(--muted)" }}>{timeAgo(u.created_at)}</td>
                            <td>
                              <span style={{ color: "var(--accent)", fontWeight: 500 }}>
                                {u.consents ?? "—"}
                              </span>
                            </td>
                            <td><StatusBadge status={u.status} /></td>
                            <td>
                              <a
                                className="action-link"
                                onClick={(e) => { e.stopPropagation(); loadRow(u); }}
                              >
                                Inspect →
                              </a>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

          </div>
        </main>
      </div>
    </>
  );
}
