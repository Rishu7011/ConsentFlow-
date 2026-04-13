"use client";

import React, { useEffect, useState } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import api from '@/lib/axios';
import './css/consent.css';



const purposeGateMap: Record<string, string> = {
  inference: 'inference',
  analytics: 'dataset',
  model_training: 'training',
  pii: 'drift',
  webhook: 'drift',
};

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const PURPOSES = ['analytics', 'inference', 'model_training', 'pii', 'webhook'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ConsentPage() {
  const [consentData, setConsentData] = useState<any[]>([]);
  const [globalUserId, setGlobalUserId] = useState('');
  const [formUserId, setFormUserId] = useState('');
  const [formPurpose, setFormPurpose] = useState('');
  const [formDataType, setFormDataType] = useState('');
  const [revokePurpose, setRevokePurpose] = useState('');
  const [checkPurpose, setCheckPurpose] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<'granted' | 'revoked'>('granted');
  const [currentTab, setCurrentTab] = useState<'matrix' | 'list'>('matrix');
  
  const [checkResult, setCheckResult] = useState<{ userId: string, purpose: string, status?: string, dataType?: string, cached?: boolean, updatedAt?: string, notFound?: boolean } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ userId: string, purpose: string } | null>(null);
  const [toasts, setToasts] = useState<Array<{ id: number, msg: string, type: string }>>([]);

  // Pre-fill UUID from sessionStorage (persisted from Users/Infer page)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('active_user_id');
      if (saved && UUID_RE.test(saved)) {
        setTimeout(() => {
          setGlobalUserId(saved);
          setFormUserId(saved);
        }, 0);
      }
    }
  }, []);

  // Fetch real consent data list
  useEffect(() => {
    api.get('/consent').then(res => {
      setConsentData(res.data.map((r: any) => ({
        userId: r.user_id,
        email: r.user_id.substring(0, 8),
        purpose: r.purpose,
        dataType: r.data_type,
        status: r.status,
        cached: false,
        updatedAt: r.updated_at
      })));
    }).catch(e => console.warn('Failed to load consent data', e));
  }, []);

  const isGlobalUuidValid = globalUserId ? UUID_RE.test(globalUserId.trim()) : false;
  
  // Gate statuses
  const resolveGateStatus = (gateName: string, userId: string) => {
    if (!userId || !UUID_RE.test(userId.trim())) return 'pending';
    const relPurposes = Object.entries(purposeGateMap).filter(([, v]) => v === gateName).map(([k]) => k);
    const recs = consentData.filter(r => r.userId === userId && relPurposes.includes(r.purpose));
    if (!recs.length) return 'pending';
    const anyRevoked = recs.some(r => r.status === 'revoked');
    if (anyRevoked) return 'blocked';
    return 'active';
  };

  const showToast = (msg: string, type: string = 'info') => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => {
      setToasts(t => t.filter(toast => toast.id !== id));
    }, 3500);
  };

  const handleGlobalUuidChange = (val: string) => {
    setGlobalUserId(val);
    if (UUID_RE.test(val.trim())) {
      setFormUserId(val);
    }
  };

  const submitConsent = async () => {
    const userId = formUserId.trim();
    if (!userId || !UUID_RE.test(userId)) { showToast('Invalid or missing User UUID', 'error'); return; }
    if (!formPurpose) { showToast('Please select a purpose', 'error'); return; }
    if (!formDataType) { showToast('Please select a data type', 'error'); return; }

    try {
      // API call placeholder for backend integration
      await api.post('/consent', {
        user_id: userId,
        purpose: formPurpose,
        data_type: formDataType,
        status: selectedStatus
      });

      // Update local state
      setConsentData(prev => {
        const newData = [...prev];
        const idx = newData.findIndex(r => r.userId === userId && r.purpose === formPurpose && r.dataType === formDataType);
        const email = prev.find(r => r.userId === userId)?.email || 'New User';
        const rec = { userId, email, purpose: formPurpose, dataType: formDataType, status: selectedStatus, cached: false, updatedAt: new Date().toISOString() };
        if (idx >= 0) newData[idx] = rec;
        else newData.push(rec);
        return newData;
      });

      showToast(`Consent ${selectedStatus === 'granted' ? 'granted' : 'updated to revoked'} — ${formPurpose} / ${formDataType}`, selectedStatus === 'granted' ? 'success' : 'warning');
    } catch (err) {
      const e = err as any;
      const status = e?.response?.status ?? 500;
      const detail = e?.response?.data?.detail ?? 'Request failed';
      if (status === 404) {
        showToast('User not found — register this UUID first', 'error');
      } else if (status === 422) {
        showToast('Invalid payload — check UUID and fields', 'error');
      } else if (status === 503) {
        showToast('Backend offline — consent not saved', 'error');
      } else {
        showToast(`Error ${status}: ${detail}`, 'error');
      }
    }
  };

  const checkStatus = async () => {
    const userId = (globalUserId.trim() || formUserId.trim());
    if (!userId || !UUID_RE.test(userId)) { showToast('Enter a valid User UUID first', 'error'); return; }
    if (!checkPurpose) { showToast('Select a purpose to check', 'error'); return; }

    try {
      // Attempt backend API call
      const res = await api.get(`/consent/${userId}/${checkPurpose}`);
      setCheckResult({
        userId: res.data.user_id,
        purpose: res.data.purpose,
        status: res.data.status,
        cached: res.data.cached,
        updatedAt: res.data.updated_at,
        dataType: 'all' // backend response might omit datatype if doing effective check, fallback
      });
      showToast(`Checked live data for ${checkPurpose}`, 'success');
    } catch (err) {
      const e = err as any;
      const status = e?.response?.status ?? 500;
      const detail = e?.response?.data?.detail ?? 'Request failed';
      if (status === 404) {
        setCheckResult({ notFound: true, userId, purpose: checkPurpose });
      } else if (status === 422) {
        showToast('Invalid UUID format', 'error');
      } else if (status === 503) {
        showToast('Backend offline — cannot check consent status', 'error');
      } else {
        showToast(`Error ${status}: ${detail}`, 'error');
      }
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    const { userId, purpose } = revokeTarget;

    try {
      await api.post('/consent/revoke', {
        user_id: userId,
        purpose: purpose
      });
      
      setConsentData(prev =>
        prev.map(r =>
          r.userId === userId && r.purpose === purpose
            ? { ...r, status: 'revoked', cached: false, updatedAt: new Date().toISOString() }
            : r
        )
      );
      
      setRevokeTarget(null);
      setCheckResult(null);
      showToast(`Revocation broadcast — ${purpose} × all data types → Kafka`, 'warning');
    } catch (err) {
      const e = err as any;
      console.warn("Revoke API failed, updating locally", e);
      setConsentData(prev =>
        prev.map(r =>
          r.userId === userId && r.purpose === purpose
            ? { ...r, status: 'revoked', cached: false, updatedAt: new Date().toISOString() }
            : r
        )
      );
      setRevokeTarget(null);
      setCheckResult(null);
      showToast(`Revocation applied locally (API disconnected)`, 'warning');
    }
  };

  const listUsers = Array.from(new Set(consentData.map(r => r.userId)));
  const sortedConsentData = [...consentData].sort((a,b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return (
    <>
      <div className="mesh"></div>
      
      {/* Toast Container */}
      <div className="toast-container" id="toastContainer">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`} style={{ opacity: 1, transform: 'translateX(0)', transition: 'all 0.3s' }}>
            <span>{t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : t.type === 'warning' ? '⚠' : 'ℹ'}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>

      {/* Revoke Modal */}
      <div className={`modal-overlay ${revokeTarget ? 'open' : ''}`} id="revokeModal">
        <div className="modal">
          <div className="modal-header">
            <div className="modal-title">⚠ Confirm Revocation</div>
            <button className="btn btn-icon btn-sm" onClick={() => setRevokeTarget(null)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div className="modal-body">
            <p>This will revoke consent for <strong style={{color:'var(--text)'}}>ALL data types</strong> matching the user and purpose. This action propagates to all enforcement gates via Kafka.</p>
            <div className="modal-highlight" id="revokeDetails">
              {revokeTarget ? `user_id: ${revokeTarget.userId}\npurpose: ${revokeTarget.purpose}\naffects: ALL data types` : ''}
            </div>
            <p>Gate enforcement will block inference, training, and dataset access within milliseconds of revocation.</p>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setRevokeTarget(null)}>Cancel</button>
            <button className="btn btn-coral" onClick={confirmRevoke}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              Confirm Revoke
            </button>
          </div>
        </div>
      </div>

      <div className="app">
        <Sidebar currentRoute="/consent" />

        <main className="main">
          {/* TOPBAR */}
          <div className="topbar">
            <div className="topbar-left">
              <div className="page-title">Consent Manager</div>
              <div className="page-sub">Grant, revoke, and inspect consent records per user and purpose</div>
            </div>
            <div className="topbar-right">
              <button className="btn" onClick={() => { setConsentData([...consentData]); showToast('Consent matrix refreshed', 'info'); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Refresh
              </button>
              <button className="btn btn-primary" onClick={() => document.getElementById('consentFormAnchor')?.scrollIntoView({behavior:'smooth'})}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                New Consent
              </button>
            </div>
          </div>

          <div className="content">
            {/* USER LOOKUP BAR */}
            <div className="user-lookup-card anim-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{flexShrink:0, color:'var(--muted)'}}><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              <span className="user-lookup-label">Active User</span>
              <div className="uuid-input-wrap">
                <svg className="uuid-icon" width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                <input 
                  className={`uuid-input ${globalUserId ? (isGlobalUuidValid ? 'valid' : 'invalid') : ''}`} 
                  id="globalUserId" 
                  type="text" 
                  placeholder="Enter user UUID to populate form fields (e.g. 550e8400-e29b-41d4-a716-446655440000)" 
                  value={globalUserId}
                  onChange={(e) => handleGlobalUuidChange(e.target.value)} 
                />
                <span className={`uuid-status ${globalUserId ? (isGlobalUuidValid ? 'valid' : 'invalid') : ''}`}>
                  {isGlobalUuidValid ? '✓ Valid UUID' : '✗ Invalid UUID'}
                </span>
              </div>
              
              {isGlobalUuidValid && (
                <div className="user-badge" id="userBadge">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  <span>{consentData.find(r => r.userId === globalUserId.trim())?.email || 'Unknown User'}</span>
                </div>
              )}
            </div>

            {/* TWO COLUMN */}
            <div className="two-col">

              {/* LEFT: CONSENT FORM */}
              <div style={{display:'flex',flexDirection:'column',gap:'16px'}} id="consentFormAnchor">

                {/* GRANT / UPDATE FORM */}
                <div className="panel anim-2">
                  <div className="panel-header">
                    <div className="panel-title">
                      <span className="panel-title-dot purple"></span>
                      Grant or Update Consent
                    </div>
                    <span style={{fontSize:'10px',color:'var(--muted2)',fontWeight:500}}>POST /consent</span>
                  </div>
                  <div className="panel-body">
                    <div className="form-group">
                      <label className="form-label">User ID *</label>
                      <input 
                        className="form-input" 
                        type="text" 
                        placeholder="uuid" 
                        style={{fontFamily:"'JetBrains Mono',monospace",fontSize:'12px'}} 
                        value={formUserId}
                        onChange={(e) => setFormUserId(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Purpose *</label>
                      <select className="form-select" value={formPurpose} onChange={(e) => setFormPurpose(e.target.value)}>
                        <option value="">Select purpose…</option>
                        {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <span className="form-hint">Maps to enforcement gate scope</span>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Data Type *</label>
                      <select className="form-select" value={formDataType} onChange={(e) => setFormDataType(e.target.value)}>
                        <option value="">Select data type…</option>
                        <option value="pii">pii</option>
                        <option value="webhook">webhook</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Consent Status *</label>
                      <div className="status-selector">
                        <div className={`status-opt ${selectedStatus === 'granted' ? 'selected-granted' : ''}`} onClick={() => setSelectedStatus('granted')}>
                          <div className="status-radio"></div> Granted
                        </div>
                        <div className={`status-opt ${selectedStatus === 'revoked' ? 'selected-revoked' : ''}`} onClick={() => setSelectedStatus('revoked')}>
                          <div className="status-radio"></div> Revoked
                        </div>
                      </div>
                    </div>
                    <div className="form-divider"></div>
                    <div className="form-actions">
                      <button className="btn btn-primary" onClick={submitConsent}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        Save Consent Record
                      </button>
                    </div>
                  </div>
                </div>

                {/* CHECK STATUS PANEL */}
                <div className="panel anim-3" id="checkResultView">
                  <div className="panel-header">
                    <div className="panel-title">
                      <span className="panel-title-dot teal"></span>
                      Check Consent Status
                    </div>
                    <span style={{fontSize:'10px',color:'var(--muted2)',fontWeight:500}}>GET /consent/:id/:purpose</span>
                  </div>
                  <div className="check-form">
                    <div className="check-row">
                      <div className="form-group">
                        <label className="form-label">Purpose</label>
                        <select className="form-select" value={checkPurpose} onChange={(e) => setCheckPurpose(e.target.value)}>
                          <option value="">Select…</option>
                          {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <button className="btn btn-teal" style={{height:'38px',alignSelf:'flex-end'}} onClick={checkStatus}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                        Check
                      </button>
                    </div>
                  </div>
                  
                  {checkResult && (
                    <div style={{padding:'0 20px 20px'}}>
                      {checkResult.notFound ? (
                        <div className="check-result">
                          <div className="check-result-header padding">
                            <span style={{fontSize:'12px',color:'var(--muted)'}}>No record found for <strong style={{color:'var(--text)'}}>{checkResult.purpose}</strong></span>
                            <span className="consent-badge pending"><span className="badge-dot"></span>Not Set</span>
                          </div>
                          <div className="result-meta">
                            <div className="meta-row"><span className="meta-key">user_id</span><span className="meta-val">{checkResult.userId}</span></div>
                            <div className="meta-row"><span className="meta-key">purpose</span><span className="meta-val">{checkResult.purpose}</span></div>
                            <div className="meta-row"><span className="meta-key">status</span><span className="meta-val">—</span></div>
                          </div>
                        </div>
                      ) : (
                        <div className="check-result">
                          <div className={`check-result-header ${checkResult.status}`}>
                            <span style={{fontSize:'12px',color:'var(--muted)'}}>Status for <strong style={{color:'var(--text)'}}>{checkResult.purpose}</strong></span>
                            <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                              {checkResult.cached && <span className="cache-tag">⚡ Cached</span>}
                              <span className={`consent-badge ${checkResult.status}`}><span className="badge-dot"></span>{checkResult.status}</span>
                            </div>
                          </div>
                          <div className="result-meta">
                            <div className="meta-row"><span className="meta-key">user_id</span><span className="meta-val">{checkResult.userId.substring(0,18)}…</span></div>
                            <div className="meta-row"><span className="meta-key">purpose</span><span className="meta-val">{checkResult.purpose}</span></div>
                            <div className="meta-row"><span className="meta-key">data_type</span><span className="meta-val">{checkResult.dataType || 'all'}</span></div>
                            <div className="meta-row"><span className="meta-key">cached</span><span className="meta-val">{checkResult.cached ? 'true' : 'false'}</span></div>
                            <div className="meta-row"><span className="meta-key">updated_at</span><span className="meta-val">{relTime(checkResult.updatedAt)}</span></div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* REVOKE PANEL */}
                <div className="panel anim-4">
                  <div className="panel-header">
                    <div className="panel-title">
                      <span className="panel-title-dot coral"></span>
                      Revoke Consent
                    </div>
                    <span style={{fontSize:'10px',color:'var(--muted2)',fontWeight:500}}>POST /consent/revoke</span>
                  </div>
                  <div className="panel-body">
                    <div className="revoke-card">
                      <div className="revoke-warn">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                        Revokes ALL data types for the user + purpose combination
                      </div>
                      <div className="form-group">
                        <label className="form-label">Purpose to Revoke</label>
                        <select className="form-select" value={revokePurpose} onChange={(e) => setRevokePurpose(e.target.value)}>
                          <option value="">Select purpose…</option>
                          {PURPOSES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <button className="btn btn-coral" style={{width:'100%'}} onClick={() => {
                        const userId = (globalUserId.trim() || formUserId.trim());
                        if (!userId || !UUID_RE.test(userId)) { showToast('Enter a valid User UUID first', 'error'); return; }
                        if (!revokePurpose) { showToast('Select a purpose to revoke', 'error'); return; }
                        setRevokeTarget({ userId, purpose: revokePurpose });
                      }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                        Revoke Consent
                      </button>
                    </div>
                  </div>
                </div>

              </div>

              {/* RIGHT: CONSENT MATRIX */}
              <div style={{display:'flex',flexDirection:'column',gap:'16px'}}>

                {/* MATRIX PANEL */}
                <div className="panel anim-2">
                  <div className="panel-header">
                    <div className="panel-title">
                      <span className="panel-title-dot purple"></span>
                      Consent Matrix
                    </div>
                    <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
                      <span style={{fontSize:'11px',color:'var(--muted2)'}} id="matrixUpdated">Live update</span>
                      <button className="btn btn-sm" onClick={() => setConsentData([...consentData])}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        Refresh
                      </button>
                    </div>
                  </div>

                  <div className="tab-bar">
                    <div className={`tab ${currentTab === 'matrix' ? 'active' : ''}`} onClick={() => setCurrentTab('matrix')}>Matrix View</div>
                    <div className={`tab ${currentTab === 'list' ? 'active' : ''}`} onClick={() => setCurrentTab('list')}>List View</div>
                  </div>

                  {currentTab === 'matrix' && (
                    <div id="tabMatrix">
                      <div className="matrix-wrap">
                        <table className="matrix-table" id="matrixTable">
                          <thead>
                            <tr>
                              <th>User</th>
                              <th className="purpose-col">analytics</th>
                              <th className="purpose-col">inference</th>
                              <th className="purpose-col">model_training</th>
                              <th className="purpose-col">pii</th>
                              <th className="purpose-col">webhook</th>
                            </tr>
                          </thead>
                          <tbody>
                            {listUsers.map(uid => {
                              const rec0 = consentData.find(r => r.userId === uid);
                              const email = rec0?.email || uid.substring(0,8)+'…';
                              return (
                                <tr key={uid}>
                                  <td>
                                    <div className="email-cell">{email}</div>
                                    <div className="uid-cell">{uid.substring(0,18)}…</div>
                                  </td>
                                  {PURPOSES.map(p => {
                                    const rec = consentData.find(r => r.userId === uid && r.purpose === p);
                                    if (!rec) {
                                      return (
                                        <td key={`${uid}-${p}`}>
                                          <div className="matrix-cell"><span className="consent-badge pending" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>—</span></div>
                                        </td>
                                      )
                                    }
                                    return (
                                        <td key={`${uid}-${p}`}>
                                          <div className="matrix-cell">
                                            <span className={`consent-badge ${rec.status}`} style={{fontSize:'10px',padding:'2px 8px'}}>
                                              <span className="badge-dot"></span>{rec.status}
                                            </span>
                                            {rec.cached && <span className="cache-tag" style={{fontSize:'9px',padding:'1px 5px',marginLeft: '4px'}}>⚡</span>}
                                          </div>
                                        </td>
                                    )
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {currentTab === 'list' && (
                    <div id="tabList">
                      <table className="matrix-table" id="listTable">
                        <thead>
                          <tr>
                            <th>User ID</th>
                            <th>Purpose</th>
                            <th>Data Type</th>
                            <th>Status</th>
                            <th>Updated</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedConsentData.map((r, i) => (
                            <tr key={`${r.userId}-${r.purpose}-${i}`}>
                              <td className="uid-cell">{r.userId.substring(0,18)}…</td>
                              <td><span style={{fontSize:'12px'}}>{r.purpose}</span></td>
                              <td><code style={{fontSize:'11px',background:'rgba(255,255,255,0.05)',padding:'2px 6px',borderRadius:'4px'}}>{r.dataType}</code></td>
                              <td>
                                <span className={`consent-badge ${r.status}`} style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>{r.status}</span>
                                {r.cached && <span className="cache-tag" style={{marginLeft:'4px',fontSize:'9px'}}>⚡</span>}
                              </td>
                              <td style={{fontSize:'11.5px',color:'var(--muted)'}}>{relTime(r.updatedAt)}</td>
                              <td>
                                <button className="btn btn-sm" style={{fontSize:'10px',padding:'3px 8px'}} onClick={() => {
                                  setGlobalUserId(r.userId);
                                  handleGlobalUuidChange(r.userId);
                                  setCheckPurpose(r.purpose);
                                  // Can auto check status here but React state might not update immediately for inputs before the network call... 
                                  // we can just directly check:
                                  api.get(`/consent/${r.userId}/${r.purpose}`).then(res => {
                                    setCheckResult({
                                      userId: res.data.user_id,
                                      purpose: res.data.purpose,
                                      status: res.data.status,
                                      cached: res.data.cached,
                                      updatedAt: res.data.updated_at,
                                      dataType: 'all'
                                    });
                                    document.getElementById('checkResultView')?.scrollIntoView({behavior:'smooth',block:'center'});
                                    showToast(`Checked live data for ${r.purpose}`, 'success');
                                  }).catch(() => {
                                    setCheckResult({...r});
                                    document.getElementById('checkResultView')?.scrollIntoView({behavior:'smooth',block:'center'});
                                  });
                                }}>Inspect</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* LEGEND */}
                <div style={{display:'flex',alignItems:'center',gap:'16px',padding:'4px 2px'}}>
                  <span style={{fontSize:'11px',color:'var(--muted)'}}>Legend:</span>
                  <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                    <div className="consent-badge granted"><span className="badge-dot"></span>Granted</div>
                    <div className="consent-badge revoked"><span className="badge-dot"></span>Revoked</div>
                    <div className="consent-badge pending"><span className="badge-dot"></span>Not Set</div>
                    <div className="cache-tag">⚡ Cached</div>
                  </div>
                </div>

                {/* GATE ENFORCEMENT PANEL */}
                <div className="panel anim-3">
                  <div className="panel-header">
                    <div className="panel-title">
                      <span className="panel-title-dot teal"></span>
                      Gate Enforcement Map
                    </div>
                  </div>
                  <div style={{padding:'16px',display:'flex',flexDirection:'column',gap:'8px'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                      
                      <div className={`gate-card ${resolveGateStatus('dataset', globalUserId) === 'blocked' ? 'blocked' : resolveGateStatus('dataset', globalUserId) === 'pending' ? '' : 'active'}`}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                          <span className="gate-tag dataset">Dataset</span>
                          {resolveGateStatus('dataset', globalUserId) === 'blocked' ? (
                            <span className="consent-badge revoked" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>BLOCKED</span>
                          ) : resolveGateStatus('dataset', globalUserId) === 'pending' ? (
                            <span className="consent-badge pending" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>—</span>
                          ) : (
                            <span className="consent-badge granted" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>ALLOW</span>
                          )}
                        </div>
                        <div style={{fontSize:'11px',color:'var(--muted)'}}>MLflow Dataset Store</div>
                      </div>
                      
                      <div className={`gate-card ${resolveGateStatus('training', globalUserId) === 'blocked' ? 'blocked' : resolveGateStatus('training', globalUserId) === 'pending' ? '' : 'active'}`}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                          <span className="gate-tag training">Training</span>
                          {resolveGateStatus('training', globalUserId) === 'blocked' ? (
                            <span className="consent-badge revoked" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>BLOCKED</span>
                          ) : resolveGateStatus('training', globalUserId) === 'pending' ? (
                            <span className="consent-badge pending" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>—</span>
                          ) : (
                            <span className="consent-badge granted" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>ALLOW</span>
                          )}
                        </div>
                        <div style={{fontSize:'11px',color:'var(--muted)'}}>MLflow Training Run</div>
                      </div>

                      <div className={`gate-card ${resolveGateStatus('inference', globalUserId) === 'blocked' ? 'blocked' : resolveGateStatus('inference', globalUserId) === 'pending' ? '' : 'active'}`}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                          <span className="gate-tag inference">Inference</span>
                          {resolveGateStatus('inference', globalUserId) === 'blocked' ? (
                            <span className="consent-badge revoked" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>BLOCKED</span>
                          ) : resolveGateStatus('inference', globalUserId) === 'pending' ? (
                            <span className="consent-badge pending" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>—</span>
                          ) : (
                            <span className="consent-badge granted" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>ALLOW</span>
                          )}
                        </div>
                        <div style={{fontSize:'11px',color:'var(--muted)'}}>ML Model Prediction</div>
                      </div>

                      <div className={`gate-card ${resolveGateStatus('drift', globalUserId) === 'blocked' ? 'blocked' : resolveGateStatus('drift', globalUserId) === 'pending' ? '' : 'active'}`}>
                        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
                          <span className="gate-tag drift">Drift</span>
                          {resolveGateStatus('drift', globalUserId) === 'blocked' ? (
                            <span className="consent-badge revoked" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>BLOCKED</span>
                          ) : resolveGateStatus('drift', globalUserId) === 'pending' ? (
                            <span className="consent-badge pending" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>—</span>
                          ) : (
                            <span className="consent-badge granted" style={{fontSize:'10px',padding:'2px 8px'}}><span className="badge-dot"></span>ALLOW</span>
                          )}
                        </div>
                        <div style={{fontSize:'11px',color:'var(--muted)'}}>Evidently Report</div>
                      </div>

                    </div>
                    <div style={{fontSize:'11px',color:'var(--muted2)',marginTop:'4px'}}>
                      Gate status reflects selected user&apos;s current consent. Kafka broadcasts revocation in real-time.
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
