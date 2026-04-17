'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import {
  usePolicyScan,
  usePolicyScans,
  usePolicyScanDetail,
  type PolicyScanResult,
} from '@/hooks/usePolicyAuditor';
import './policy.css';

// ── Helpers ────────────────────────────────────────────────────────────────

function relTime(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function fullTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ShieldIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ flexShrink: 0, color: '#34d399' }}>
      <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7l-9-5z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" fill="rgba(52,211,153,0.12)" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RiskBanner({ result }: { result: PolicyScanResult }) {
  const lvl = result.overall_risk_level;
  return (
    <div className={`risk-banner ${lvl}`}>
      <div className="risk-level-label">Overall Risk Level</div>
      <div className="risk-level-value">{lvl}</div>
      <div className="risk-meta-row">
        <div className="risk-meta-item">
          <span className="risk-meta-key">Findings</span>
          <span className="risk-meta-val">{result.findings_count}</span>
        </div>
        <div className="risk-meta-item">
          <span className="risk-meta-key">Integration</span>
          <span className="risk-meta-val">{result.integration_name}</span>
        </div>
        <div className="risk-meta-item">
          <span className="risk-meta-key">Scanned</span>
          <span className="risk-meta-val">{fullTime(result.scanned_at)}</span>
        </div>
        {result.policy_url && (
          <div className="risk-meta-item">
            <span className="risk-meta-key">Source URL</span>
            <a href={result.policy_url} target="_blank" rel="noreferrer"
              className="risk-meta-val"
              style={{ color: '#34d399', textDecoration: 'underline', fontSize: '12px', wordBreak: 'break-all' }}>
              {result.policy_url.length > 60
                ? result.policy_url.substring(0, 60) + '…'
                : result.policy_url}
            </a>
          </div>
        )}
      </div>
      {result.raw_summary && (
        <div className="raw-summary">{result.raw_summary}</div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function PolicyAuditorPage() {
  const router = useRouter();

  // Form state
  const [integrationName, setIntegrationName] = useState('');
  const [mode, setMode] = useState<'url' | 'text'>('url');
  const [policyUrl, setPolicyUrl] = useState('');
  const [policyText, setPolicyText] = useState('');
  const [riskFilter, setRiskFilter] = useState<string | undefined>(undefined);

  // Results state
  const [activeResult, setActiveResult] = useState<PolicyScanResult | null>(null);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [pendingScanName, setPendingScanName] = useState<string | null>(null);

  // Hooks
  const scanMutation = usePolicyScan();
  const { data: recentScans = [] } = usePolicyScans(riskFilter);
  const { data: scanDetail } = usePolicyScanDetail(selectedScanId);

  // When a row's detail loads, push it into the results section
  React.useEffect(() => {
    if (scanDetail) {
      setActiveResult(scanDetail);
      setPendingScanName(null); // Clear pending state if it loaded via polling
    }
  }, [scanDetail]);

  // Watch for background completion of timed-out scans
  React.useEffect(() => {
    if (pendingScanName && recentScans.length > 0) {
      // Find if our pending integration name showed up in the recent scans
      const found = recentScans.find(s => s.integration_name.toLowerCase() === pendingScanName.toLowerCase());
      if (found) {
         setSelectedScanId(found.scan_id); // This will trigger scanDetail to fetch and display!
      }
    }
  }, [recentScans, pendingScanName]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleScan = () => {
    if (!integrationName.trim()) return;
    const payload: { integration_name: string; policy_url?: string; policy_text?: string } = {
      integration_name: integrationName.trim(),
    };
    if (mode === 'url' && policyUrl.trim()) payload.policy_url = policyUrl.trim();
    if (mode === 'text' && policyText.trim()) payload.policy_text = policyText.trim();

    setSelectedScanId(null); // clear previous row selection
    setPendingScanName(null); // reset background pending state
    
    scanMutation.mutate(payload, {
      onSuccess: (data) => {
        setActiveResult(data);
      },
      onError: (err: any) => {
        // If the request times out locally, the backend is still processing.
        // We set pendingScanName to keep the UI spinning and wait for the table polling to catch it.
        if (err?.code === 'ECONNABORTED' || err?.message?.includes('timeout') || err?.response?.status === 504) {
          setPendingScanName(payload.integration_name);
        }
      }
    });
  };

  const handleRowClick = (scanId: string) => {
    setSelectedScanId(scanId === selectedScanId ? null : scanId);
  };

  // Inline error message
  const errorMessage = (() => {
    if (pendingScanName) return null; // We are hiding the error to show a perpetual loading spinner instead!
    if (!scanMutation.isError) return null;
    
    const err = scanMutation.error as any;
    if (err?.code === 'ECONNABORTED' || err?.message?.includes('timeout') || err?.response?.status === 504) {
       // Should be caught by pendingScanName above, but just in case
       return null;
    }
    if (err?.response?.status === 422) return 'Could not fetch that URL — verify the address is publicly reachable.';
    if (err?.response?.status === 503) return 'Ollama is not reachable from the backend. Is Ollama running?';
    if (err?.response?.status === 500) return 'Backend error during scan — check the terminal logs for details.';
    return 'Scan failed. Please verify the backend is running and retry.';
  })();

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
      <div className="mesh" />

      <div className="layout">
        <Sidebar />

        <main className="main">
          {/* ── TOPBAR ─────────────────────────────────────────────── */}
          <div className="topbar fade1">
            <div className="topbar-left">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <ShieldIcon size={22} />
                <div>
                  <h1 className="page-title">Policy Auditor</h1>
                  <p className="page-sub">
                    Scan AI plugin Terms of Service for consent bypass clauses
                  </p>
                </div>
              </div>
            </div>
            <div className="topbar-right">
              <span className="gate-badge">Gate 05</span>
            </div>
          </div>

          <div className="content">

            {/* ── SCAN FORM ──────────────────────────────────────────── */}
            <div className="card fade2" style={{ maxWidth: 680, marginBottom: '2rem' }}>
              <div className="card-header">
                <span className="card-title">Scan a Policy</span>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                {/* Integration name */}
                <div>
                  <label className="policy-label">Integration Name *</label>
                  <input
                    id="policy-integration-name"
                    type="text"
                    className="policy-input"
                    placeholder="e.g. Claude Plugin, OpenAI Codex"
                    value={integrationName}
                    onChange={(e) => setIntegrationName(e.target.value)}
                  />
                </div>

                {/* Mode toggle */}
                <div>
                  <label className="policy-label">Policy Source</label>
                  <div className="radio-group">
                    <div
                      id="policy-mode-url"
                      className={`radio-option ${mode === 'url' ? 'active' : ''}`}
                      onClick={() => setMode('url')}
                    >
                      <span className="radio-dot" />
                      Scan by URL
                    </div>
                    <div
                      id="policy-mode-text"
                      className={`radio-option ${mode === 'text' ? 'active' : ''}`}
                      onClick={() => setMode('text')}
                    >
                      <span className="radio-dot" />
                      Paste Policy Text
                    </div>
                  </div>
                </div>

                {/* Conditional input */}
                {mode === 'url' ? (
                  <div>
                    <label className="policy-label">Policy URL</label>
                    <input
                      id="policy-url-input"
                      type="url"
                      className="policy-input"
                      placeholder="https://openai.com/policies/terms-of-use"
                      value={policyUrl}
                      onChange={(e) => setPolicyUrl(e.target.value)}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="policy-label">Policy Text</label>
                    <textarea
                      id="policy-text-input"
                      className="policy-input policy-textarea"
                      rows={6}
                      placeholder="Paste the full Terms of Service or Privacy Policy text here…"
                      value={policyText}
                      onChange={(e) => setPolicyText(e.target.value)}
                    />
                  </div>
                )}

                {/* Submit */}
                <button
                  id="policy-scan-btn"
                  className="btn-scan"
                  onClick={handleScan}
                  disabled={scanMutation.isPending || !!pendingScanName || !integrationName.trim()}
                >
                  {(scanMutation.isPending || pendingScanName) ? (
                    <>
                      <span className="spinner" />
                      Analysing…
                    </>
                  ) : (
                    <>
                      <ShieldIcon size={16} />
                      Scan for Risks
                    </>
                  )}
                </button>

                {/* Inline error */}
                {errorMessage && (
                  <div className="error-banner">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    {errorMessage}
                  </div>
                )}
              </div>
            </div>

            {/* ── RESULTS SECTION ────────────────────────────────────── */}
            {activeResult && (
              <div className="fade2" style={{ marginBottom: '2rem', maxWidth: 800 }}>
                {/* Risk banner */}
                <RiskBanner result={activeResult} />

                {/* Findings list */}
                {activeResult.findings.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {activeResult.findings.map((f, idx) => (
                      <div
                        key={f.id}
                        className="finding-card"
                        style={{ animationDelay: `${idx * 60}ms` }}
                      >
                        <div className="finding-header">
                          <span className="finding-category">{f.category}</span>
                          <span className={`sev-badge ${f.severity}`}>{f.severity}</span>
                        </div>
                        {f.clause_excerpt && (
                          <blockquote className="finding-excerpt">
                            "{f.clause_excerpt}"
                          </blockquote>
                        )}
                        <div className="finding-explanation">{f.explanation}</div>
                        {f.article_reference && (
                          <div className="finding-article">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
                                stroke="currentColor" strokeWidth="1.5" />
                              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
                                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                            {f.article_reference}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-policy" style={{ background: 'rgba(52,211,153,0.04)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 10 }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.5 }}>
                      <path d="M9 12l2 2 4-4" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="12" cy="12" r="10" stroke="#34d399" strokeWidth="1.5" />
                    </svg>
                    No consent-bypass clauses detected.
                  </div>
                )}

                {/* View in Audit Trail */}
                <div style={{ marginTop: '16px' }}>
                  <button
                    id="policy-view-audit-btn"
                    className="btn-audit"
                    onClick={() => router.push('/audit')}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
                        stroke="currentColor" strokeWidth="1.5" />
                      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    View in Audit Trail
                  </button>
                </div>
              </div>
            )}

            {/* ── RECENT SCANS TABLE ─────────────────────────────────── */}
            <div className="table-panel anim-3" style={{ maxWidth: 800 }}>
              <div className="table-header">
                <div className="table-title">
                  <span className="table-title-dot" />
                  Recent Scans
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <select
                    id="policy-risk-filter"
                    className="filter-select"
                    value={riskFilter ?? ''}
                    onChange={(e) => setRiskFilter(e.target.value || undefined)}
                    style={{ width: 130, fontSize: 12 }}
                  >
                    <option value="">All risks</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="table-wrap">
                <table className="scans-table">
                  <thead>
                    <tr>
                      <th>Integration</th>
                      <th>Risk Level</th>
                      <th>Findings</th>
                      <th>Scanned At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentScans.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          <div className="empty-policy">
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.25 }}>
                              <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7l-9-5z"
                                stroke="currentColor" strokeWidth="1.5" />
                            </svg>
                            No scans yet — run your first policy scan above.
                          </div>
                        </td>
                      </tr>
                    ) : (
                      recentScans.map((scan) => (
                        <tr
                          key={scan.scan_id}
                          className={selectedScanId === scan.scan_id ? 'active-row' : ''}
                          onClick={() => handleRowClick(scan.scan_id)}
                          title="Click to load this scan's findings"
                        >
                          <td>
                            <span style={{ fontWeight: 600, color: 'var(--text)' }}>
                              {scan.integration_name}
                            </span>
                          </td>
                          <td>
                            <span className={`risk-pill ${scan.overall_risk_level}`}>
                              {scan.overall_risk_level}
                            </span>
                          </td>
                          <td>
                            <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                              {scan.findings_count} finding{scan.findings_count !== 1 ? 's' : ''}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                              {relTime(scan.scanned_at)}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--muted2)', marginTop: 2 }}>
                              {fullTime(scan.scanned_at)}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </main>
      </div>
    </>
  );
}
