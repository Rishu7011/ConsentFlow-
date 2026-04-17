"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { HealthWidget } from '@/components/dashboard/HealthWidget';

import './css/dashboard.css';
import Sidebar from '@/components/layout/Sidebar';
import api from '@/lib/axios';
import { useAuditTrail } from '@/hooks/useAuditTrail';

// Relative time helper
function relTime(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function Dashboard() {
  const router = useRouter();

  const PURPOSE_CONFIG = [
    { key: 'analytics', color: 'var(--accent2)', gradient: 'rgba(62,207,178,0.4)' },
    { key: 'inference', color: 'var(--accent)', gradient: 'rgba(124,109,250,0.4)' },
    { key: 'training', color: 'var(--amber)', gradient: 'rgba(245,166,35,0.4)' },
    { key: 'pii', color: 'var(--accent3)', gradient: 'rgba(250,109,138,0.4)' },
    { key: 'webhook', color: 'var(--accent2)', gradient: 'rgba(62,207,178,0.4)' }
  ];

  const [metrics, setMetrics] = useState({ 
    users: 0, 
    granted: 0, 
    blocked: 0,
    purposes: {} as Record<string, number>,
    checks_24h_total: 0,
    checks_24h_allowed: 0,
    checks_24h_blocked: 0,
    checks_sparkline: Array(24).fill(0),
    policy_scans_total: 0,
    policy_scans_critical: 0,
  });

  const [sec, setSec] = useState(0);

  // ── Backend health state ──
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [retrying, setRetrying] = useState(false);
  const healthRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Real audit trail — 15s polling ──
  const { data: auditData, refetch: refetchAudit } = useAuditTrail({ limit: 8 }, 15000);
  const recentEvents = auditData?.entries ?? [];

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/dashboard-stats');
      setMetrics(res.data);
    } catch {
      // Ignored
    }
  }, []);

  const checkHealth = useCallback(async (isManual = false) => {
    if (isManual) setRetrying(true);
    try {
      await api.get('/health', { timeout: 4000 });
      setBackendOnline(true);
      fetchStats();
    } catch {
      setBackendOnline(false);
    } finally {
      if (isManual) setRetrying(false);
    }
  }, [fetchStats]);

  // Poll health every 10 s
  useEffect(() => {
    checkHealth();
    healthRef.current = setInterval(() => checkHealth(), 10_000);
    return () => { if (healthRef.current) clearInterval(healthRef.current); };
  }, [checkHealth]);

  useEffect(() => {
    const timer = setInterval(() => setSec(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshData = () => {
    setSec(0);
    checkHealth(true);
    refetchAudit();
  };

  useEffect(() => {
    // Metric card glow
    const handleMouseMove = (e: MouseEvent) => {
      const card = e.currentTarget as HTMLElement;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
    };

    const cards = document.querySelectorAll('.metric-card');
    cards.forEach(card => card.addEventListener('mousemove', handleMouseMove as EventListener));

    return () => {
      cards.forEach(card => card.removeEventListener('mousemove', handleMouseMove as EventListener));
    };
  }, []);

  return (
    <>
      <div className="mesh"></div>

      <div className="layout">
        {/* SIDEBAR */}
        <Sidebar />

        {/* MAIN */}
        <main className="main">

          {/* TOPBAR */}
          <div className="topbar fade1">
            <div>
              <h1 className="page-title">Dashboard</h1>
              <p className="page-sub">System overview &amp; consent enforcement status</p>
            </div>
            <div className="topbar-right">
              {/* ── Backend status badge ── */}
              {backendOnline === null ? (
                <div className="badge-live" style={{ borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.08)', color: 'rgba(245,166,35,0.9)' }}>
                  <div className="dot amber pulse" />
                  Connecting…
                </div>
              ) : backendOnline ? (
                <div className="badge-live">
                  <div className="dot green pulse" />
                  Live
                  <span className="last-updated">Updated {sec < 60 ? `${sec}s` : `${Math.floor(sec/60)}m`} ago</span>
                </div>
              ) : (
                <div
                  className="badge-live"
                  title="Click to retry connection"
                  onClick={() => checkHealth(true)}
                  style={{
                    borderColor: 'rgba(250,109,138,0.4)',
                    background: 'rgba(250,109,138,0.08)',
                    color: 'rgba(250,109,138,0.95)',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <div className="dot red" style={{ animation: 'none' }} />
                  {retrying ? 'Retrying…' : 'Backend Offline'}
                  {!retrying && <span className="last-updated" style={{ color: 'rgba(250,109,138,0.55)' }}>click to retry</span>}
                </div>
              )}
              <button className="btn" onClick={refreshData}>{retrying ? '…' : '↻'} Refresh</button>
              <button className="btn primary" onClick={() => router.push('/consent')}>+ New Consent</button>
            </div>
          </div>

          {/* METRICS */}
          <div className="metrics fade2">
            <MetricCard 
              label="Total users"
              value={metrics.users.toLocaleString()}
              accent="purple"
              delta={{ value: 'Realtime', up: true, text: 'data' }}
            />
            <MetricCard 
              label="Consents granted"
              value={metrics.granted.toLocaleString()}
              accent="teal"
              delta={{ value: 'Live', up: true, text: 'syncing' }}
            />
            <MetricCard 
              label="Inferences blocked"
              value={metrics.blocked.toLocaleString()}
              accent="coral"
              delta={{ value: 'Kafka', up: false, text: 'broadcasted' }}
            />
            <MetricCard 
              label="Avg response time"
              value="<5ms"
              accent="amber"
              secondaryText={<span>Redis cache hit rate <span style={{ color: 'var(--accent2)' }}>94%</span></span>}
            />
            {/* Gate 05 — Policy Auditor */}
            <div
              className="metric-card"
              onClick={() => router.push('/policy')}
              style={{ cursor: 'pointer' }}
              title="Go to Policy Auditor"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Policies Scanned
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', lineHeight: 1, color: 'var(--accent)' }}>
                    {metrics.policy_scans_total.toLocaleString()}
                  </div>
                  {metrics.policy_scans_critical > 0 ? (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--accent3)', fontWeight: 500 }}>
                      {metrics.policy_scans_critical} critical risk
                    </div>
                  ) : (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--muted2)' }}>
                      No critical risks
                    </div>
                  )}
                </div>
                <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'rgba(124,109,250,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8">
                    <path d="M12 3l7 4v5c0 4.5-3 8.7-7 10C8 20.7 5 16.5 5 12V7l7-4z"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* GATES ROW */}
          <div className="gates-row fade3">
            <div className="gate-card purple">
              <div className="gate-icon purple">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c6dfa" strokeWidth="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v4c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 9v4c0 1.66 4.03 3 9 3s9-1.34 9-3V9"/><path d="M3 13v4c0 1.66 4.03 3 9 3s9-1.34 9-3v-4"/></svg>
              </div>
              <div className="gate-name">Dataset gate</div>
              <div className="gate-stat purple">342</div>
              <div className="gate-label">records scanned today</div>
            </div>
            <div className="gate-card teal">
              <div className="gate-icon teal">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3ecfb2" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><path d="M6 6l4 4M14 14l4 4M18 6l-4 4M10 14l-4 4"/></svg>
              </div>
              <div className="gate-name">Training gate</div>
              <div className="gate-stat teal">7</div>
              <div className="gate-label">runs quarantined</div>
            </div>
            <div className="gate-card coral">
              <div className="gate-icon coral">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fa6d8a" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              </div>
              <div className="gate-name">Inference gate</div>
              <div className="gate-stat coral">137</div>
              <div className="gate-label">requests blocked</div>
            </div>
            <div className="gate-card amber">
              <div className="gate-icon amber">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f5a623" strokeWidth="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/><circle cx="22" cy="12" r="1" fill="#f5a623"/></svg>
              </div>
              <div className="gate-name">Drift monitor</div>
              <div className="gate-stat amber">3</div>
              <div className="gate-label">critical alerts</div>
            </div>
          </div>

          {/* AUDIT + HEALTH */}
          <div className="two-col fade4">

            {/* AUDIT TABLE */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Recent audit events</span>
                <Link href="/audit" className="card-action">View all →</Link>
              </div>
              <div className="card-body" style={{ padding: '0 1.25rem' }}>
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Gate</th>
                      <th>Purpose</th>
                      <th>Action</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentEvents.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '18px 0', color: 'var(--muted2)', fontSize: '12px' }}>
                          {backendOnline === false
                            ? 'Backend offline — no audit data'
                            : 'Loading recent events…'}
                        </td>
                      </tr>
                    ) : recentEvents.map((e) => (
                      <tr key={e.id}>
                        <td><span className="uuid">{e.user_id.substring(0, 8)}</span></td>
                        <td><span className="gate-tag">{e.gate_name.replace('_gate', '')}</span></td>
                        <td>{e.purpose ?? '—'}</td>
                        <td>
                          <span className={`pill ${e.action_taken === 'ALLOW' ? 'allow' : 'block'}`}>
                            {e.action_taken}
                          </span>
                        </td>
                        <td>{relTime(e.event_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* HEALTH */}
              <HealthWidget />

              {/* ACTIVITY FEED */}
              <div className="card" style={{ flex: 1 }}>
                <div className="card-header">
                  <span className="card-title">Live activity</span>
                  <span className="badge-live" style={{ fontSize: '10px', padding: '3px 9px' }}>
                    <div className="dot green pulse"></div>Streaming
                  </span>
                </div>
                <div className="card-body" style={{ padding: '.25rem 1.25rem' }}>
                  <div className="activity-item">
                    <div className="activity-dot" style={{ background: 'var(--accent3)' }}></div>
                    <div className="activity-content">
                      <div className="activity-text">Inference blocked for user <strong>550e8400</strong> — consent revoked</div>
                      <div className="activity-meta">inference_gate · 2s ago</div>
                    </div>
                  </div>
                  <div className="activity-item">
                    <div className="activity-dot" style={{ background: 'var(--amber)' }}></div>
                    <div className="activity-content">
                      <div className="activity-text">MLflow run <strong>#run-4821</strong> quarantined via Kafka event</div>
                      <div className="activity-meta">training_gate · 14s ago</div>
                    </div>
                  </div>
                  <div className="activity-item">
                    <div className="activity-dot" style={{ background: 'var(--accent2)' }}></div>
                    <div className="activity-content">
                      <div className="activity-text">Webhook received from OneTrust for user <strong>a716-4466</strong></div>
                      <div className="activity-meta">webhook · 38s ago</div>
                    </div>
                  </div>
                  <div className="activity-item">
                    <div className="activity-dot" style={{ background: 'var(--accent2)' }}></div>
                    <div className="activity-content">
                      <div className="activity-text">Consent granted — <strong>pii / analytics</strong> for user 123e4567</div>
                      <div className="activity-meta">consent_api · 1m ago</div>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* BOTTOM ROW */}
          <div className="three-col fade5">

            {/* CONSENT BY PURPOSE */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Consent by purpose</span>
              </div>
              <div className="card-body">
                <div className="consent-bars">
                  {PURPOSE_CONFIG.map(p => {
                    const count = metrics.purposes[p.key] || 0;
                    const pct = metrics.users > 0 ? Math.round((count / metrics.users) * 100) : 0;
                    return (
                      <div className="consent-row" key={p.key}>
                        <div className="consent-label">{p.key}</div>
                        <div className="consent-track">
                          <div 
                            className="consent-fill" 
                            style={{ 
                              width: `${pct}%`, 
                              background: `linear-gradient(90deg,${p.color},${p.gradient})` 
                            }}
                          ></div>
                        </div>
                        <div className="consent-count">{pct}%</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* INFERENCE TREND */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Inference checks (24h)</span>
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '1rem' }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', color: 'var(--accent)' }}>
                    {metrics.checks_24h_total.toLocaleString()}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>total checks</span>
                </div>
                <div className="spark-row" id="sparkline">
                  {metrics.checks_sparkline.map((v, i, arr) => {
                    const max = Math.max(...arr) || 1;
                    const pct = (v / max) * 100;
                    return (
                      <div 
                        key={i}
                        className={`spark-bar${pct > 80 ? ' peak' : pct > 60 ? ' hi' : ''}`}
                        style={{ height: `${Math.max(2, pct)}%` }}
                        title={`${v} checks`}
                      />
                    );
                  })}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.5rem', fontSize: '10px', color: 'var(--muted2)' }}>
                  <span>00:00(T-24h)</span><span>06:00</span><span>12:00</span><span>18:00</span><span>now</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', marginTop: '1rem' }}>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Allowed <span style={{ color: 'var(--accent2)', fontWeight: 500 }}>{metrics.checks_24h_allowed.toLocaleString()}</span></div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>Blocked <span style={{ color: 'var(--accent3)', fontWeight: 500 }}>{metrics.checks_24h_blocked.toLocaleString()}</span></div>
                </div>
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Quick actions</span>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Link href="/users" style={{ textDecoration: 'none' }}>
                  <button className="btn" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    Register new user
                  </button>
                </Link>
                <Link href="/consent" style={{ textDecoration: 'none' }}>
                  <button className="btn" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l7 4v5c0 4.5-3 8.7-7 10C8 20.7 5 16.5 5 12V7l7-4z"/><path d="M9 12l2 2 4-4"/></svg>
                    Grant consent
                  </button>
                </Link>
                <Link href="/webhook" style={{ textDecoration: 'none' }}>
                  <button className="btn" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                    Simulate webhook
                  </button>
                </Link>
                <Link href="/infer" style={{ textDecoration: 'none' }}>
                  <button className="btn" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    Test inference gate
                  </button>
                </Link>
                <Link href="/audit" style={{ textDecoration: 'none' }}>
                  <button className="btn" style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                    View full audit trail
                  </button>
                </Link>
              </div>
            </div>
          </div>

        </main>
      </div>
    </>
  );
}
