"use client";

import React, { useState, useEffect } from 'react';
import api from '@/lib/axios';
import './infer.css';
import Sidebar from '@/components/layout/Sidebar';

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

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const handleUuidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUuid(e.target.value);
  };

  const handleUuidBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Persist only when the user leaves the field, not on every keystroke
    sessionStorage.setItem('active_user_id', e.target.value);
  };

  const fireInference = async () => {
    const trimmedUuid = uuid.trim();
    if (!trimmedUuid) {
      setStatus('error');
      setErrorMsg('User ID is required');
      return;
    }
    if (!UUID_RE.test(trimmedUuid)) {
      setStatus('error');
      setErrorMsg('Invalid UUID format — expected xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
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
    <>
      <div className="mesh"></div>

      <div className="layout">
        {/* SIDEBAR */}
        <Sidebar />

        <main className="main">
          <div className="topbar fade1">
            <div>
              <h1 className="page-title">Inference Tester</h1>
              <p className="page-sub">Live test of the ConsentMiddleware gate</p>
            </div>
          </div>

          <div className="card fade2" style={{ maxWidth: '600px', marginTop: '2rem' }}>
            <div className="card-header">
              <span className="card-title">Run Prediction</span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              <div>
                <label className="infer-label">User ID (UUID)</label>
                <input 
                  type="text" 
                  value={uuid} 
                  onChange={handleUuidChange} 
                  placeholder="e.g. 123e4567-e89b-12d3-a456-426614174000"
                  className="infer-input"
                />
              </div>

              <div>
                <label className="infer-label">Prompt</label>
                <textarea 
                  value={prompt} 
                  onChange={e => setPrompt(e.target.value)}
                  rows={4}
                  className="infer-input infer-textarea"
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
                <div className="result-box result-allowed">
                  <div className="result-title">
                    <div className="dot green pulse"></div> Inference allowed
                  </div>
                  <div className="prediction-label">Prediction:</div>
                  <div className="prediction-text">{prediction}</div>
                </div>
              )}

              {status === 'blocked' && (
                <div className="result-box result-blocked">
                  <div className="result-title">
                    <div className="dot red pulse"></div> Blocked — consent revoked
                  </div>
                  <div className="blocked-subtext">
                    The ConsentMiddleware evaluated <code>X-User-ID</code> and blocked execution at the application edge.
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="result-box result-error">
                  <div className="result-title">Error</div>
                  <div className="blocked-subtext">{errorMsg}</div>
                </div>
              )}

              {status === 'unavailable' && (
                <div className="result-box" style={{ background: 'var(--surface2)', border: '1px solid var(--border2)' }}>
                  <div className="result-title" style={{ color: 'var(--text)' }}>Consent engine unavailable</div>
                  <div className="blocked-subtext">FastAPI backend is down.</div>
                </div>
              )}

            </div>
          </div>
        </main>
      </div>
    </>
  );
}
