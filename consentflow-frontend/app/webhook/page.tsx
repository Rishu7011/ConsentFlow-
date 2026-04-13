"use client";

import React, { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/layout/Sidebar";
import "./css/webhook.css";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GATE_LABELS: Record<string, string> = {
  dataset_gate: "Dataset Gate",
  training_gate: "Training Gate",
  inference_gate: "Inference Gate",
  monitoring_gate: "Drift Monitor",
};

const GATE_ICONS: Record<string, React.ReactNode> = {
  dataset_gate: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  training_gate: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  inference_gate: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <polygon points="13,2 3,14 12,14 11,22 21,10 12,10" />
    </svg>
  ),
  monitoring_gate: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
};

type GateState = "idle" | "blocking" | "propagating";
type HistoryEntry = {
  code: number;
  userId: string;
  purpose: string;
  time: Date;
};

export default function WebhookPage() {
  const [jsonInput, setJsonInput] = useState(() => {
    return `{\n  "userId": "550e8400-e29b-41d4-a716-446655440000",\n  "purpose": "analytics",\n  "consentStatus": "revoked",\n  "timestamp": "${new Date().toISOString().slice(0, 19)}Z"\n}`;
  });
  
  const [quickUserId, setQuickUserId] = useState("");
  const [quickPurpose, setQuickPurpose] = useState("analytics");
  
  const [isValid, setIsValid] = useState(true);
  const [validationMsg, setValidationMsg] = useState("Valid payload");
  const [quickUserErr, setQuickUserErr] = useState(false);
  
  const [gateStates, setGateStates] = useState<Record<string, GateState>>({
    dataset_gate: "idle",
    training_gate: "idle",
    inference_gate: "idle",
    monitoring_gate: "idle",
  });
  
  const [loading, setLoading] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  
  const [responseState, setResponseState] = useState<"idle" | "responded">("idle");
  const [responseCode, setResponseCode] = useState<number | null>(null);
  const [responseData, setResponseData] = useState<any>(null);
  const [responseTime, setResponseTime] = useState<number>(0);
  const [respondedAt, setRespondedAt] = useState<string>("");
  
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  
  const [toasts, setToasts] = useState<{id: number; msg: string; color: string; removing: boolean}[]>([]);
  
  const toastIdCounter = useRef(0);

  const showToast = (msg: string, color = 'var(--accent)') => {
    const id = toastIdCounter.current++;
    setToasts(prev => [...prev, { id, msg, color, removing: false }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t));
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 200);
    }, 3000);
  };

  const validatePayload = (raw: string) => {
    try {
      const p = JSON.parse(raw);
      const missing = [];
      if (!p.userId) missing.push('userId');
      if (!p.purpose) missing.push('purpose');
      if (!p.consentStatus) missing.push('consentStatus');

      if (missing.length) {
        setIsValid(false);
        setValidationMsg(`Missing: ${missing.join(', ')}`);
        return false;
      }

      if (!UUID_REGEX.test(p.userId)) {
        setIsValid(false);
        setValidationMsg('userId must be a valid UUID');
        return false;
      }

      if (p.consentStatus !== 'revoked') {
        setIsValid(false);
        setValidationMsg('consentStatus must be "revoked"');
        return false;
      }
      
      setIsValid(true);
      setValidationMsg('Valid payload — ready to fire');
      return true;
    } catch(e) {
      setIsValid(false);
      setValidationMsg('Invalid JSON syntax');
      return false;
    }
  };

  const handleJsonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setJsonInput(val);
    validatePayload(val);
  };

  const syncFromQuick = (uid: string, purpose: string) => {
    setQuickUserId(uid);
    setQuickPurpose(purpose);
    
    // Validate UUID quickly for quick user
    if (uid && !UUID_REGEX.test(uid)) {
      setQuickUserErr(true);
    } else {
      setQuickUserErr(false);
    }

    try {
      const p = JSON.parse(jsonInput);
      if (uid) p.userId = uid;
      p.purpose = purpose;
      const newVal = JSON.stringify(p, null, 2);
      setJsonInput(newVal);
      validatePayload(newVal);
    } catch(e) {
      // Ignored
    }
  };

  const formatJson = () => {
    try {
      const formatted = JSON.stringify(JSON.parse(jsonInput), null, 2);
      setJsonInput(formatted);
      validatePayload(formatted);
      showToast('Formatted', 'var(--accent)');
    } catch(e) {
      showToast('Invalid JSON — cannot format', 'var(--coral)');
    }
  };

  const copyPayload = () => {
    navigator.clipboard.writeText(jsonInput).then(() => {
      showToast('Payload copied to clipboard', 'var(--teal)');
    });
  };

  const fireWebhook = async () => {
    if (!validatePayload(jsonInput)) {
      showToast('Fix validation errors before firing', 'var(--coral)');
      return;
    }

    setLoading(true);

    const newGateStates: Record<string, GateState> = {};
    Object.keys(gateStates).forEach(k => newGateStates[k] = 'propagating');
    setGateStates(newGateStates);

    let payload: any;
    try { payload = JSON.parse(jsonInput); }
    catch(e) { setLoading(false); return; }

    const t0 = performance.now();
    
    // Simulate latency
    await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
    const elapsed = Math.round(performance.now() - t0);

    const isPartial = Math.random() > 0.7; // 30% chance 207
    const statusCode = isPartial ? 207 : 200;

    const mockResponse = {
      status: isPartial ? 'partial' : 'propagated',
      user_id: payload.userId,
      purpose: payload.purpose,
      kafka_published: !isPartial,
      warning: isPartial ? 'Kafka broker temporarily unavailable. DB updated.' : null
    };
    
    setResponseState("responded");
    setResponseCode(statusCode);
    setResponseData(mockResponse);
    setResponseTime(elapsed);
    setRespondedAt(new Date().toLocaleTimeString());
    
    setHistory(prev => {
      const nw = [{ code: statusCode, userId: payload.userId, purpose: payload.purpose, time: new Date() }, ...prev];
      if (nw.length > 20) nw.pop();
      return nw;
    });

    setTimeout(() => {
      setGateStates(prev => {
        const finishedStates: Record<string, GateState> = {};
        Object.keys(prev).forEach(k => finishedStates[k] = 'blocking');
        return finishedStates;
      });
    }, 300);

    setLoading(false);
    showToast(statusCode === 200 ? 'Webhook propagated successfully' : 'Partial success — check Kafka status', statusCode === 200 ? 'var(--teal)' : 'var(--amber)');
  };

  const resetAll = () => {
    const initial = `{\n  "userId": "550e8400-e29b-41d4-a716-446655440000",\n  "purpose": "analytics",\n  "consentStatus": "revoked",\n  "timestamp": "${new Date().toISOString().slice(0, 19)}Z"\n}`;
    setJsonInput(initial);
    setQuickUserId("");
    setQuickPurpose("analytics");
    setResponseState("idle");
    setResponseCode(null);
    setResponseData(null);
    
    const idles: Record<string, GateState> = {};
    Object.keys(gateStates).forEach(k => idles[k] = 'idle');
    setGateStates(idles);
    
    validatePayload(initial);
    showToast('Reset to defaults', 'var(--accent)');
  };

  const loadExample = () => {
    const ex = `{\n  "userId": "550e8400-e29b-41d4-a716-446655440000",\n  "purpose": "inference",\n  "consentStatus": "revoked",\n  "timestamp": "${new Date().toISOString().slice(0, 19)}Z"\n}`;
    setJsonInput(ex);
    setQuickPurpose("inference");
    validatePayload(ex);
    showToast('Example payload loaded', 'var(--accent)');
  };

  const loadHistoryEntry = (i: number) => {
    const entry = history[i];
    if (!entry) return;
    const restored = JSON.stringify({
      userId: entry.userId, purpose: entry.purpose,
      consentStatus: 'revoked', timestamp: entry.time.toISOString()
    }, null, 2);
    setJsonInput(restored);
    setQuickUserId(entry.userId);
    setQuickPurpose(entry.purpose);
    validatePayload(restored);
    showToast(`Restored history entry #${i + 1}`, 'var(--accent)');
  };
  
  // Update relative times artificially for history
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(i => i + 1), 10000);
    return () => clearInterval(t);
  }, []);

  const getRelTime = (date: Date) => {
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s/60)}m ago`;
  };

  return (
    <div className="layout">
      <Sidebar />
      <main className="main">
        {/* TOPBAR */}
        <div className="topbar">
          <div className="topbar-left">
            <div className="page-badge">
              <div className="page-badge-dot"></div>
              SIMULATOR
            </div>
            <h1 className="page-title">Webhook Simulator</h1>
          </div>
          <div className="topbar-right">
            <button className="btn btn-ghost" onClick={resetAll}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 1 0 .49-3.43"/></svg>
              Reset
            </button>
            <button className="btn btn-ghost" onClick={loadExample}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
              Load Example
            </button>
            <div className="endpoint-badge">
              <span className="method-tag">POST</span>
              /webhook/consent-revoke
            </div>
          </div>
        </div>

        <div className="content">
          <div className="section-header">
            <div className="section-title">OneTrust-style Consent Revocation</div>
            <div className="section-desc">Fire a revocation webhook to propagate consent changes across all pipeline gates in real time. ConsentFlow will update PostgreSQL, invalidate Redis, and broadcast a Kafka event.</div>
          </div>

          <div className="simulator-grid">
            {/* LEFT — PAYLOAD EDITOR */}
            <div>
              <div className="card" id="editor-card">
                <div className="card-header">
                  <div className="card-title-row">
                    <div className="card-icon purple">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="16,18 22,12 16,6"/><polyline points="8,6 2,12 8,18"/></svg>
                    </div>
                    <div>
                      <div className="card-title">Payload Editor</div>
                      <div className="card-subtitle">JSON · camelCase fields</div>
                    </div>
                  </div>
                  <div className={`validation-strip show ${isValid ? 'ok' : 'err'}`}>
                    {isValid ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20,6 9,17 4,12"/></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    )}
                    <span>{validationMsg}</span>
                  </div>
                </div>

                <div className="card-body">
                  <div className="info-box">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <span>This endpoint uses <strong style={{color:'var(--text)'}}>camelCase</strong> field names — note <code style={{fontFamily:'JetBrains Mono',fontSize:'11px',color:'var(--accent)'}}>userId</code> and <code style={{fontFamily:'JetBrains Mono',fontSize:'11px',color:'var(--accent)'}}>consentStatus</code> differ from the rest of the API. Only <code style={{fontFamily:'JetBrains Mono',fontSize:'11px',color:'var(--coral)'}}>"revoked"</code> is accepted as <code style={{fontFamily:'JetBrains Mono',fontSize:'11px',color:'var(--accent)'}}>consentStatus</code>.</span>
                  </div>

                  <div className="field">
                    <div className="json-editor-wrap">
                      <div className="json-editor-toolbar">
                        <span className="json-lang-tag">JSON</span>
                        <div className="json-actions">
                          <button className="btn-tiny" onClick={formatJson}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
                            Format
                          </button>
                          <button className="btn-tiny" onClick={copyPayload}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            Copy
                          </button>
                        </div>
                      </div>
                      <textarea 
                        className="json-textarea" 
                        spellCheck="false" 
                        value={jsonInput}
                        onChange={handleJsonChange}
                        placeholder="Enter JSON payload..."
                      />
                    </div>
                    <div className="field-hint">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
                      Pre-filled with demo user UUID. Replace with a real UUID from the Users page.
                    </div>
                  </div>

                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginTop:'14px'}}>
                    <div className="field">
                      <div className="field-label">
                        <div className="required-dot"></div> Quick — User ID
                      </div>
                      <input 
                        className={`input ${quickUserErr ? 'error' : ''}`}
                        placeholder="Paste UUID…" 
                        value={quickUserId}
                        onChange={e => syncFromQuick(e.target.value, quickPurpose)} 
                      />
                      <div className={`field-error ${quickUserErr ? 'show' : ''}`}>Invalid UUID format</div>
                    </div>
                    <div className="field">
                      <div className="field-label">
                        <div className="required-dot"></div> Quick — Purpose
                      </div>
                      <select 
                        className="select" 
                        value={quickPurpose}
                        onChange={e => syncFromQuick(quickUserId, e.target.value)}
                      >
                        <option value="analytics">analytics</option>
                        <option value="inference">inference</option>
                        <option value="model_training">model_training</option>
                        <option value="pii">pii</option>
                        <option value="webhook">webhook</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="fire-area">
                  <div className="fire-meta">
                    Target: <strong>POST /webhook/consent-revoke</strong>
                    &nbsp;·&nbsp; Backend: <strong>localhost:8000</strong>
                  </div>
                  <button className={`btn btn-fire ${loading ? 'loading' : ''}`} onClick={fireWebhook}>
                    <svg className="fire-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>
                    <div className="spinner"></div>
                    Fire Webhook
                  </button>
                </div>
              </div>

              {/* HISTORY */}
              <div className="card history-card">
                <div className="card-header">
                  <div className="card-title-row">
                    <div className="card-icon teal">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
                    </div>
                    <div>
                      <div className="card-title">Request History</div>
                      <div className="card-subtitle">{history.length} request{history.length !== 1 ? 's' : ''} this session</div>
                    </div>
                  </div>
                  <button className="btn-tiny" onClick={() => setHistory([])} style={{fontSize:'11px'}}>Clear</button>
                </div>
                <div className="history-list">
                  {history.length === 0 ? (
                    <div style={{padding:'20px 18px',textAlign:'center',color:'var(--muted2)',fontSize:'12px'}}>No requests yet. Fire a webhook to see history.</div>
                  ) : (
                    history.map((h, i) => {
                      const cls = h.code === 200 ? 's200' : h.code === 207 ? 's207' : h.code === 422 ? 's422' : 's500';
                      const shortId = h.userId ? h.userId.slice(0, 8) + '…' : '—';
                      return (
                        <div key={i} className="history-item" onClick={() => loadHistoryEntry(i)}>
                          <div className={`history-status ${cls}`}>{h.code}</div>
                          <div className="history-details">
                            <div className="history-user">{shortId}</div>
                            <div className="history-purpose">{h.purpose || '—'}</div>
                          </div>
                          <div className="history-time">{getRelTime(h.time)}</div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT — RESPONSE PANEL */}
            <div>
              <div className="card">
                <div className="card-header">
                  <div className="card-title-row">
                    <div className="card-icon coral">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                    </div>
                    <div>
                      <div className="card-title">Response</div>
                      <div className="card-subtitle">{responseState === "idle" ? "Awaiting request…" : `${responseTime}ms · ${respondedAt}`}</div>
                    </div>
                  </div>
                  {responseState === 'responded' && (
                    <div style={{
                      display:'flex',alignItems:'center',gap:'5px',padding:'3px 9px',borderRadius:'20px',
                      fontSize:'10px',fontWeight:500,letterSpacing:'0.04em',
                      background: responseData?.kafka_published ? 'rgba(62,207,178,0.1)' : 'rgba(245,166,35,0.1)',
                      border: `1px solid ${responseData?.kafka_published ? 'rgba(62,207,178,0.2)' : 'rgba(245,166,35,0.2)'}`,
                      color: responseData?.kafka_published ? 'var(--teal)' : 'var(--amber)'
                    }}>
                      {responseData?.kafka_published ? (
                        <><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20,6 9,17 4,12"/></svg> KAFKA OK</>
                      ) : (
                        <><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> KAFKA FAIL</>
                      )}
                    </div>
                  )}
                </div>

                <div className="card-body">
                  {responseState === "idle" ? (
                    <div className="idle-state">
                      <div className="idle-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
                      </div>
                      <div className="idle-title">Ready to fire</div>
                      <div className="idle-sub">Configure your payload and click <em>Fire Webhook</em> to broadcast a revocation event.</div>
                    </div>
                  ) : (
                    <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
                      <div className={`status-display ${responseCode === 200 ? 'success' : responseCode === 207 ? 'partial' : 'error'}`}>
                        <div className="status-code-badge">{responseCode}</div>
                        <div className="status-info">
                          <div className="status-label">
                            {responseCode === 200 ? 'Propagated' : responseCode === 207 ? 'Multi-Status — Partial Success' : 'Error'}
                          </div>
                          <div className="status-sub">
                            {responseCode === 200 ? 'Consent revocation stored in DB, Redis invalidated, and broadcast to all pipeline gates via Kafka.' 
                            : responseCode === 207 ? 'DB updated successfully, but Kafka publish failed.' 
                            : 'Request failed. Check payload and backend status.'}
                          </div>
                        </div>
                      </div>

                      {responseCode === 207 && (
                        <div className="warning-207">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                          <div>
                            <strong>Partial Success — 207 Multi-Status</strong>
                            <span>{responseData?.warning || 'DB updated successfully, but Kafka event failed to publish. Downstream gates may not have been notified in real time.'}</span>
                          </div>
                        </div>
                      )}

                      <div className="response-fields">
                        <div className="resp-row">
                          <span className="resp-key">status</span>
                          <span className={`resp-val ${responseData?.status === 'propagated' ? 'ok' : 'warn'}`}>{responseData?.status}</span>
                        </div>
                        <div className="resp-row">
                          <span className="resp-key">user_id</span>
                          <span className="resp-val" style={{fontSize:'10.5px',maxWidth:'200px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{responseData?.user_id}</span>
                        </div>
                        <div className="resp-row">
                          <span className="resp-key">purpose</span>
                          <span className="resp-val">{responseData?.purpose}</span>
                        </div>
                        <div className="resp-row">
                          <span className="resp-key">kafka_published</span>
                          <span className={`resp-val ${responseData?.kafka_published ? 'ok' : 'fail'}`}>{String(responseData?.kafka_published)}</span>
                        </div>
                        {responseData?.warning && (
                          <div className="resp-row">
                            <span className="resp-key">warning</span>
                            <span className="resp-val warn">{responseData?.warning}</span>
                          </div>
                        )}
                      </div>

                      <div>
                        <div className={`raw-toggle ${rawOpen ? 'open' : ''}`} onClick={() => setRawOpen(!rawOpen)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9,18 15,12 9,6"/></svg>
                          Raw JSON response
                        </div>
                        {rawOpen && (
                          <pre className="raw-response open">
                            {JSON.stringify({ status: responseCode, body: responseData }, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* PROPAGATION VISUALIZER */}
              <div className="card" style={{marginTop:'20px', animationDelay:'0.15s'}}>
                <div className="card-header">
                  <div className="card-title-row">
                    <div className="card-icon amber">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><path d="M5 20a7 7 0 0 1 14 0"/><circle cx="5" cy="20" r="2"/><circle cx="12" cy="20" r="2"/><circle cx="19" cy="20" r="2"/></svg>
                    </div>
                    <div>
                      <div className="card-title">Propagation Status</div>
                      <div className="card-subtitle">Gate enforcement after revocation</div>
                    </div>
                  </div>
                </div>
                <div className="card-body" style={{padding:'14px 18px'}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
                    {Object.entries(GATE_LABELS).map(([key, label]) => {
                      const state = gateStates[key];
                      const colors = {
                        idle: { bg: 'rgba(255,255,255,0.03)', border: 'var(--border)', text: 'var(--muted2)', dot: 'rgba(255,255,255,0.15)', dotGlow: 'none', tag: '—' },
                        blocking: { bg: 'rgba(250,109,138,0.06)', border: 'rgba(250,109,138,0.2)', text: 'var(--coral)', dot: 'var(--coral)', dotGlow: 'var(--coral-glow)', tag: 'BLOCKING' },
                        propagating: { bg: 'rgba(245,166,35,0.06)', border: 'rgba(245,166,35,0.2)', text: 'var(--amber)', dot: 'var(--amber)', dotGlow: 'var(--amber-glow)', tag: 'NOTIFYING…' },
                      };
                      const c = colors[state] || colors.idle;
                      return (
                        <div key={key} style={{
                          background: c.bg, border: `1px solid ${c.border}`, borderRadius: '8px',
                          padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.4s'
                        }}>
                          <div style={{color: c.text, opacity: 0.8}}>{GATE_ICONS[key]}</div>
                          <div style={{flex: 1, minWidth: 0}}>
                            <div style={{fontSize: '11px', fontWeight: 500, color: 'var(--text)', marginBottom: '1px'}}>{label}</div>
                            <div style={{fontSize: '10px', color: c.text, fontFamily: "'JetBrains Mono',monospace"}}>{c.tag}</div>
                          </div>
                          <div style={{width: '7px', height: '7px', borderRadius: '50%', background: c.dot, boxShadow: `0 0 6px ${c.dotGlow}`, transition: 'all 0.4s', flexShrink: 0}}></div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* TOAST CONTAINER */}
      <div className="toast-wrap">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.removing ? 'removing' : ''}`}>
            <div className="toast-dot" style={{background: t.color}}></div>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
