"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import api from '@/lib/axios';

export default function InferenceTester() {
  const [uuid, setUuid] = useState('');
  const [prompt, setPrompt] = useState('Write a summary of our Q3 financial performance...');
  
  const [status, setStatus] = useState<'idle' | 'loading' | 'allowed' | 'blocked' | 'error' | 'unavailable'>('idle');
  const [prediction, setPrediction] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const saved = sessionStorage.getItem('active_user_id');
    if (saved) setUuid(saved);
  }, []);

  const handleUuidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUuid(e.target.value);
    sessionStorage.setItem('active_user_id', e.target.value);
  };

  const fireInference = async () => {
    if (!uuid) {
      setStatus('error');
      setErrorMsg('User ID required');
      return;
    }
    
    setStatus('loading');
    setPrediction('');
    setErrorMsg('');

    try {
      const res = await api.post('/infer/predict', { prompt }, {
        headers: { 'X-User-ID': uuid }
      });
      setStatus('allowed');
      setPrediction(res.data.prediction || 'Model produced output successfully.');
    } catch (err: any) {
      const code = err.response?.status;
      if (code === 403) {
        setStatus('blocked');
      } else if (code === 400 || code === 422) {
        setStatus('error');
        setErrorMsg('Missing or invalid user ID');
      } else if (code === 503) {
        setStatus('unavailable');
      } else {
        setStatus('error');
        setErrorMsg('Server error. Check console.');
      }
    }
  };

  return (
    <div className="layout">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark">CF</div>
          <span className="logo-text">ConsentFlow</span>
        </div>
        <nav className="nav">
          <div className="nav-section">Main</div>
          <Link href="/dashboard" className="nav-item">Dashboard</Link>
          <Link href="/users" className="nav-item">Users</Link>
          <Link href="/consent" className="nav-item">Consent</Link>
          <Link href="/audit" className="nav-item">Audit Trail</Link>
          <div className="nav-section" style={{ marginTop: '.75rem' }}>Tools</div>
          <Link href="/webhook" className="nav-item">Webhook</Link>
          <Link href="/infer" className="nav-item active">Inference Tester</Link>
        </nav>
      </aside>

      <main className="main" style={{ padding: '2rem' }}>
        <div className="topbar">
          <div>
            <h1 className="page-title">Inference Tester</h1>
            <p className="page-sub">Live test of the ConsentMiddleware gate</p>
          </div>
        </div>

        <div className="card" style={{ maxWidth: '600px', marginTop: '2rem' }}>
          <div className="card-header">
            <span className="card-title">Run Prediction</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>User ID (UUID)</label>
              <input 
                type="text" 
                value={uuid} 
                onChange={handleUuidChange} 
                placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                style={{ width: '100%', padding: '10px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>Prompt</label>
              <textarea 
                value={prompt} 
                onChange={e => setPrompt(e.target.value)}
                rows={4}
                style={{ width: '100%', padding: '10px', background: 'var(--bg)', border: '1px solid var(--border)', color: 'white', borderRadius: '4px', resize: 'vertical' }}
              />
            </div>

            <button 
              className="btn primary" 
              onClick={fireInference} 
              disabled={status === 'loading'}
              style={{ width: '100%', justifyContent: 'center', marginTop: '10px' }}>
              {status === 'loading' ? 'Checking consent...' : 'Fire /infer/predict'}
            </button>

            {/* RESULTS */}
            {status === 'allowed' && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(62,207,178,0.1)', border: '1px solid var(--accent2)', borderRadius: '6px' }}>
                <div style={{ color: 'var(--accent2)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="dot green"></div> Inference allowed
                </div>
                <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--muted)' }}>Prediction:</div>
                <div style={{ color: 'white', fontSize: '14px', marginTop: '4px' }}>{prediction}</div>
              </div>
            )}

            {status === 'blocked' && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(250,109,138,0.1)', border: '1px solid var(--accent3)', borderRadius: '6px' }}>
                <div style={{ color: 'var(--accent3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="dot red"></div> Blocked — consent revoked
                </div>
                <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5 }}>
                  The ConsentMiddleware evaluated <code>X-User-ID</code> and blocked execution at the application edge.
                </div>
              </div>
            )}

            {status === 'error' && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(245,166,35,0.1)', border: '1px solid var(--amber)', borderRadius: '6px' }}>
                <div style={{ color: 'var(--amber)', fontWeight: 600 }}>Error</div>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>{errorMsg}</div>
              </div>
            )}

            {status === 'unavailable' && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: '6px' }}>
                <div style={{ color: 'var(--text)', fontWeight: 600 }}>Consent engine unavailable</div>
                <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '4px' }}>FastAPI backend is down.</div>
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
