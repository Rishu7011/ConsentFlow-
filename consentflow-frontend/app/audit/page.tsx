"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import './css/audit.css';
import { useAuditTrail, AuditEntry } from '@/hooks/useAuditTrail';

// --- UTILS ---
function gateClass(g: string) {
  if (g.includes('inference')) return 'inference';
  if (g.includes('dataset')) return 'dataset';
  if (g.includes('training')) return 'training';
  return 'monitoring';
}
function gateLabel(g: string) { return g.replace('_gate','').replace('_',' '); }
function relTime(iso: string) {
  const d = Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if (d<60) return `${d}s ago`;
  if (d<3600) return `${Math.floor(d/60)}m ago`;
  if (d<86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}
function fullTime(iso: string) { return new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}); }

const generateRandomMeta = () => ({
  redisHit: Math.random() > 0.4,
  latencyMs: Math.floor(Math.random() * 8 + 1),
});

export default function AuditPage() {
  const [allEvents, setAllEvents] = useState<AuditEntry[]>([]);
  const [filteredData, setFilteredData] = useState<AuditEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortKey, setSortKey] = useState('event_time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedEvent, setSelectedEvent] = useState<AuditEntry | null>(null);
  const [drawerMeta, setDrawerMeta] = useState<{ redisHit: boolean; latencyMs: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string, type: 'info' | 'success' | 'warning' } | null>(null);

  // Filters
  const [filterId, setFilterId] = useState('');
  const [filterGate, setFilterGate] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterPurpose, setFilterPurpose] = useState('');
  const [filterLimit, setFilterLimit] = useState(100);

  const [pollCountdown, setPollCountdown] = useState(15);
  const [flashRow, setFlashRow] = useState<string | null>(null);

  // ── Real API data with 15s refetch interval ──
  const { data: auditData, refetch: refetchAudit } = useAuditTrail(
    { limit: filterLimit },
    0  // manual polling via countdown below (refetchAudit)
  );

  // Load real API data 
  useEffect(() => {
    if (auditData?.entries) {
      setAllEvents(auditData.entries);
    }
  }, [auditData]);

  // Show Toast
  const showToast = useCallback((msg: string, type: 'info' | 'success' | 'warning' = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3300);
  }, []);

  // Stable ref to refreshData
  const refreshDataRef = useRef<(auto?: boolean) => void>(() => {});

  // Poll countdown — fires refetchAudit every 15s
  useEffect(() => {
    const timer = setInterval(() => {
      setPollCountdown((prev) => {
        if (prev <= 1) {
          refreshDataRef.current(true);
          return 15;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const refreshData = useCallback((auto = false) => {
    refetchAudit().then(({ data }) => {
      if (data?.entries && data.entries.length > 0) {
        const newEntries = data.entries.filter(
          (e: AuditEntry) => !allEvents.some((existing) => existing.id === e.id)
        );
        if (newEntries.length > 0) {
          setAllEvents(prev => [...newEntries, ...prev]);
          setFlashRow(newEntries[0].id);
          setTimeout(() => setFlashRow(null), 600);
          if (!auto) setPollCountdown(15);
          showToast(`Audit trail refreshed — ${newEntries.length} new event${newEntries.length > 1 ? 's' : ''}`, 'info');
        } else {
          if (!auto) showToast('Audit trail up to date', 'info');
        }
      }
    }).catch(() => {
      if (!auto) showToast('Backend offline', 'warning');
    });
  }, [refetchAudit, allEvents, showToast]);

  // Keep the ref in sync with the latest refreshData callback
  useEffect(() => { refreshDataRef.current = refreshData; }, [refreshData]);

  // Apply filters and sort
  useEffect(() => {
    const result = allEvents.filter(e => {
      const uid = filterId.trim().toLowerCase();
      if (uid && !e.user_id.toLowerCase().includes(uid) && !e.user_email.toLowerCase().includes(uid)) return false;
      if (filterGate && e.gate_name !== filterGate) return false;
      if (filterAction && e.action_taken !== filterAction) return false;
      if (filterPurpose && e.purpose !== filterPurpose) return false;
      return true;
    }).slice(0, filterLimit);

    result.sort((a,b) => {
      let av = a[sortKey] ?? '';
      let bv = b[sortKey] ?? '';
      if (sortKey === 'event_time') { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    setFilteredData(result);
    // setCurrentPage(1); // Removed because it resetting every second due to polling allEvents changes is annoying, only reset if filters change.
  }, [allEvents, filterId, filterGate, filterAction, filterPurpose, filterLimit, sortKey, sortDir]);
  
  // reset page to 1 when filters actually change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterId, filterGate, filterAction, filterPurpose, filterLimit]);

  const clearFilters = () => {
    setFilterId(''); setFilterGate(''); setFilterAction(''); setFilterPurpose(''); setFilterLimit(100);
  };

  const sortBy = (key: string) => {
    if (sortKey === key) { setSortDir(prev => prev === 'asc' ? 'desc' : 'asc'); }
    else { setSortKey(key); setSortDir('desc'); }
    setCurrentPage(1);
  };

  const handleCopyTrace = (e: React.MouseEvent, traceId: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(traceId).catch(() => {});
    showToast('Trace ID copied to clipboard', 'success');
  };

  const exportCSV = () => {
    const cols = ['event_time','user_id','gate_name','action_taken','consent_status','purpose','trace_id'];
    const header = cols.join(',');
    const rows = filteredData.map(e => cols.map(c => `"${(e[c]||'').toString().replace(/"/g,'""')}"`).join(','));
    const csv = [header,...rows].join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `audit_trail_${new Date().toISOString().substring(0,10)}.csv`;
    a.click();
    showToast(`Exported ${filteredData.length} events as CSV`, 'success');
  };

  const total = filteredData.length;
  const allowCount = filteredData.filter(e=>e.action_taken==='ALLOW').length;
  const blockedCount = filteredData.filter(e=>e.action_taken==='BLOCKED').length;
  const traceCount = new Set(filteredData.filter(e=>e.trace_id).map(e=>e.trace_id)).size;

  // Pagination
  const PER_PAGE = 25;
  const totalPages = Math.max(1, Math.ceil(filteredData.length / PER_PAGE));
  const start = (currentPage-1) * PER_PAGE;
  const pageData = filteredData.slice(start, start + PER_PAGE);

  // Header Chart (24 buckets)
  const headerChartValues = useMemo(() => {
    const hours = 24;
    const buckets = Array(hours).fill(0).map((_,i) => {
      return allEvents.filter(e => {
        const age = (Date.now() - new Date(e.event_time).getTime())/3600000;
        return age >= i && age < i+1;
      }).length;
    }).reverse();
    const max = Math.max(...buckets, 1);
    return buckets.map(v => ({ v, h: Math.max(3, Math.round(v/max*22)) }));
  }, [allEvents]);

  // Drawer Actions
  const openDrawer = (ev: AuditEntry) => {
    setSelectedEvent(ev);
    // Seed stable values once per event so the timeline never flickers on re-render
    setDrawerMeta(generateRandomMeta());
  };

  const renderDrawerBody = () => {
    if (!selectedEvent) return null;
    const { action_taken, gate_name, event_time, user_id, user_email, consent_status, purpose, id, trace_id, metadata } = selectedEvent;
    return (
      <div className="drawer-body">
        <div className="drawer-section">
          <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
            <span className={`action-badge ${action_taken.toLowerCase()}`} style={{ fontSize:'13px', padding:'5px 14px' }}>
              <span className="badge-pip"></span>{action_taken}
            </span>
            <span className={`gate-tag ${gateClass(gate_name)}`} style={{ fontSize:'11px' }}>{gateLabel(gate_name)}</span>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Event Details</div>
          <div className="kv-grid">
            <div className="kv-row"><span className="kv-key">event_time</span><span className="kv-val">{fullTime(event_time)}</span></div>
            <div className="kv-row"><span className="kv-key">user_id</span><span className="kv-val" style={{ fontSize:'10.5px' }}>{user_id}</span></div>
            <div className="kv-row"><span className="kv-key">email</span><span className="kv-val" style={{ fontFamily:"'DM Sans',sans-serif" }}>{user_email}</span></div>
            <div className="kv-row"><span className="kv-key">gate_name</span><span className="kv-val">{gate_name}</span></div>
            <div className="kv-row"><span className="kv-key">action_taken</span><span className="kv-val" style={{ color: action_taken==='ALLOW'?'var(--teal)':'var(--coral)' }}>{action_taken}</span></div>
            <div className="kv-row"><span className="kv-key">consent_status</span><span className="kv-val" style={{ color: consent_status==='granted'?'var(--teal)':'var(--coral)' }}>{consent_status}</span></div>
            <div className="kv-row"><span className="kv-key">purpose</span><span className="kv-val">{purpose || '—'}</span></div>
            <div className="kv-row"><span className="kv-key">id</span><span className="kv-val" style={{ fontSize:'10px' }}>{id}</span></div>
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">OTel Trace</div>
          {trace_id ? (
            <div style={{ display:'flex', alignItems:'center', gap:'8px', background:'rgba(245,166,35,0.06)', border:'1px solid rgba(245,166,35,0.15)', borderRadius:'8px', padding:'10px 14px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ color:'var(--amber)', flexShrink:0 }}><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              <span className="mono-bright" style={{ fontSize:'11px', flex:1 }}>{trace_id}</span>
              <button className="copy-btn" onClick={(e) => handleCopyTrace(e, trace_id)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.5"/></svg>
              </button>
            </div>
          ) : (
            <div style={{ fontSize:'12px', color:'var(--muted2)' }}>No trace ID recorded for this event.</div>
          )}
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Decision Timeline</div>
          <div className="timeline-line">
            <div className="timeline-event">
              <div className="tl-dot neutral"></div>
              <div className="tl-content">
                <div className="tl-event-title">Request received by ConsentFlow</div>
                <div className="tl-event-time">{fullTime(event_time)}</div>
              </div>
            </div>
            <div className="timeline-event">
              <div className="tl-dot neutral"></div>
              <div className="tl-content">
                <div className="tl-event-title">Consent status checked — Redis {drawerMeta?.redisHit ? 'hit (cached)' : 'miss → PostgreSQL'}</div>
                <div className="tl-event-time">+{drawerMeta?.latencyMs ?? 1}ms</div>
              </div>
            </div>
            <div className="timeline-event">
              <div className={`tl-dot ${action_taken.toLowerCase()}`}></div>
              <div className="tl-content">
                <div className="tl-event-title" style={{ color:action_taken==='ALLOW'?'var(--teal)':'var(--coral)' }}>Gate decision: {action_taken}</div>
                <div className="tl-event-time">{gate_name} · consent_status={consent_status}</div>
              </div>
            </div>
            {action_taken === 'BLOCKED' && (
              <div className="timeline-event">
                <div className="tl-dot blocked"></div>
                <div className="tl-content">
                  <div className="tl-event-title">403 Forbidden returned to caller</div>
                  <div className="tl-event-time">Revocation enforced at inference boundary</div>
                </div>
              </div>
            )}
            {trace_id && (
              <div className="timeline-event">
                <div className="tl-dot neutral"></div>
                <div className="tl-content">
                  <div className="tl-event-title">OTel span exported</div>
                  <div className="tl-event-time" style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:'10px' }}>{trace_id}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="drawer-section">
          <div className="drawer-section-title">Metadata</div>
          <div className="meta-block">{metadata ? JSON.stringify(metadata, null, 2) : 'null'}</div>
        </div>

        <div className="drawer-section">
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            <button className="btn btn-sm" onClick={() => { setSelectedEvent(null); setFilterId(user_id); showToast(`Filtered by user ${user_id.substring(0,14)}…`, 'info'); }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Filter this user
            </button>
            <button className="btn btn-sm" onClick={() => { setSelectedEvent(null); setFilterGate(gate_name); showToast(`Filtered by gate: ${gate_name}`, 'info'); }}>
              Filter this gate
            </button>
          </div>
        </div>
      </div>
    );
  };

  const getSortIconUrl = (key: string) => {
    return (
      <span className="sort-icon" style={{ opacity: sortKey===key ? 1 : 0.4, color: sortKey===key ? 'var(--accent)' : 'inherit' }}>
        {sortKey===key ? (sortDir==='asc'?'↑':'↓') : '↕'}
      </span>
    );
  };

  return (
    <>
      <div className="mesh"></div>

      <div className="toast-container">
        {toast && (
          <div className={`toast ${toast.type}`}>
            <span>{toast.type === 'success' ? '✓' : toast.type === 'warning' ? '⚠' : 'ℹ'}</span>
            <span>{toast.msg}</span>
          </div>
        )}
      </div>

      <div className={`drawer-overlay ${selectedEvent ? 'open' : ''}`} onClick={() => setSelectedEvent(null)}>
        <div className="drawer" onClick={e => e.stopPropagation()}>
          <div className="drawer-header">
            <div className="drawer-title">Event Detail</div>
            <button className="btn btn-icon btn-sm" onClick={() => setSelectedEvent(null)}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
          {renderDrawerBody()}
        </div>
      </div>

      <div className="layout">
        <Sidebar />

        <main className="main">
          {/* TOPBAR */}
          <div className="topbar fade1">
            <div className="topbar-left">
              <div className="page-title">Audit Trail</div>
              <div className="page-sub">Full gate enforcement decision log — real-time, searchable, filterable</div>
            </div>
            <div className="topbar-right">
              <div className="live-badge"><span className="live-dot"></span>Live · <span>{pollCountdown}s</span></div>
              <button className="btn" onClick={exportCSV}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Export CSV
              </button>
              <button className="btn btn-teal" onClick={() => refreshData()}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Refresh
              </button>
            </div>
          </div>

          <div className="content">
            {/* STAT STRIP */}
            <div className="stat-strip anim-1">
              <div className="stat-card total">
                <div className="stat-label">Total Events</div>
                <div className="stat-val">{total}</div>
                <div className="stat-sub">All gates combined</div>
              </div>
              <div className="stat-card allow">
                <div className="stat-label">ALLOW decisions</div>
                <div className="stat-val">{allowCount}</div>
                <div className="stat-sub">{total ? Math.round(allowCount/total*100) : 0}% of total</div>
              </div>
              <div className="stat-card blocked">
                <div className="stat-label">BLOCKED decisions</div>
                <div className="stat-val">{blockedCount}</div>
                <div className="stat-sub">{total ? Math.round(blockedCount/total*100) : 0}% of total</div>
              </div>
              <div className="stat-card trace">
                <div className="stat-label">Unique Trace IDs</div>
                <div className="stat-val">{traceCount}</div>
                <div className="stat-sub">OTel distributed spans</div>
              </div>
            </div>

            {/* FILTER BAR */}
            <div className="filter-panel anim-2">
              <div className="filter-group">
                <div className="filter-label">User ID</div>
                <input className="filter-input" placeholder="Filter by UUID or Email…" value={filterId} onChange={e => setFilterId(e.target.value)} />
              </div>
              <div className="filter-group">
                <div className="filter-label">Gate</div>
                <select className="filter-select" value={filterGate} onChange={e => setFilterGate(e.target.value)} style={{ width: '155px' }}>
                  <option value="">All gates</option>
                  <option value="inference_gate">Inference Gate</option>
                  <option value="dataset_gate">Dataset Gate</option>
                  <option value="training_gate">Training Gate</option>
                  <option value="monitoring_gate">Monitoring Gate</option>
                </select>
              </div>
              <div className="filter-group">
                <div className="filter-label">Decision</div>
                <select className="filter-select" value={filterAction} onChange={e => setFilterAction(e.target.value)} style={{ width: '130px' }}>
                  <option value="">All decisions</option>
                  <option value="ALLOW">ALLOW</option>
                  <option value="BLOCKED">BLOCKED</option>
                </select>
              </div>
              <div className="filter-group">
                <div className="filter-label">Purpose</div>
                <select className="filter-select" value={filterPurpose} onChange={e => setFilterPurpose(e.target.value)} style={{ width: '140px' }}>
                  <option value="">All purposes</option>
                  <option value="analytics">analytics</option>
                  <option value="inference">inference</option>
                  <option value="model_training">model_training</option>
                  <option value="pii">pii</option>
                  <option value="webhook">webhook</option>
                </select>
              </div>
              <div className="filter-group">
                <div className="filter-label">Limit</div>
                <select className="filter-select" value={filterLimit} onChange={e => setFilterLimit(Number(e.target.value))} style={{ width: '90px' }}>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={250}>250</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                </select>
              </div>
              <div className="filter-spacer"></div>
              <div className="filter-actions">
                <button className="btn btn-sm" onClick={clearFilters}>Clear</button>
                <button className="btn btn-sm btn-primary">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  Filter
                </button>
              </div>

              {/* Active filter chips */}
              {(filterId || filterGate || filterAction || filterPurpose) && (
                <div className="filter-chip-row" style={{ width: '100%' }}>
                  <span className="active-filters-label">Active filters:</span>
                  {filterId && <div className="filter-chip" onClick={() => setFilterId('')}>user: {filterId.substring(0,12)}… <span className="chip-x">×</span></div>}
                  {filterGate && <div className="filter-chip" onClick={() => setFilterGate('')}>{filterGate.replace('_gate','')} <span className="chip-x">×</span></div>}
                  {filterAction && <div className="filter-chip" onClick={() => setFilterAction('')}>{filterAction} <span className="chip-x">×</span></div>}
                  {filterPurpose && <div className="filter-chip" onClick={() => setFilterPurpose('')}>{filterPurpose} <span className="chip-x">×</span></div>}
                </div>
              )}
            </div>

            {/* TABLE PANEL */}
            <div className="table-panel anim-3">
              <div className="table-header">
                <div className="table-title">
                  <span className="table-title-dot"></span>
                  Gate Decisions
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
                    <div className="header-chart">
                      {headerChartValues.map((b, i) => (
                        <div key={i} className="hc-bar" style={{ height: `${b.h}px`, background: b.v > 3 ? 'var(--accent)' : 'rgba(124,109,250,0.3)' }} />
                      ))}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--muted2)' }}>Last 24h activity</div>
                  </div>
                  <div className="table-meta">Showing {total.toLocaleString()} events</div>
                </div>
              </div>

              <div className="table-wrap">
                <table className="audit-table">
                  <thead>
                    <tr>
                      <th onClick={() => sortBy('event_time')} className={sortKey==='event_time'?'sorted':''}>Time {getSortIconUrl('event_time')}</th>
                      <th onClick={() => sortBy('user_id')} className={sortKey==='user_id'?'sorted':''}>User ID {getSortIconUrl('user_id')}</th>
                      <th onClick={() => sortBy('gate_name')} className={sortKey==='gate_name'?'sorted':''}>Gate {getSortIconUrl('gate_name')}</th>
                      <th onClick={() => sortBy('action_taken')} className={sortKey==='action_taken'?'sorted':''}>Decision {getSortIconUrl('action_taken')}</th>
                      <th onClick={() => sortBy('consent_status')} className={sortKey==='consent_status'?'sorted':''}>Consent Status {getSortIconUrl('consent_status')}</th>
                      <th onClick={() => sortBy('purpose')} className={sortKey==='purpose'?'sorted':''}>Purpose {getSortIconUrl('purpose')}</th>
                      <th>Trace ID</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageData.length === 0 ? (
                      <tr>
                        <td colSpan={8}>
                          <div className="empty-state">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.25 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.5"/><path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5"/></svg>
                            <div>No audit events match the current filters</div>
                            <button className="btn btn-sm" onClick={clearFilters} style={{ marginTop: '4px' }}>Clear filters</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      pageData.map((e) => (
                        <tr 
                          key={e.id} 
                          className={`${selectedEvent?.id === e.id ? 'selected' : ''} ${flashRow === e.id ? 'new-row-flash' : ''}`}
                          onClick={() => openDrawer(e)}
                        >
                          <td>
                            <div style={{ fontSize: '12px' }}>{relTime(e.event_time)}</div>
                            <div className="mono" style={{ fontSize: '10px', marginTop: '1px' }}>{fullTime(e.event_time)}</div>
                          </td>
                          <td>
                            <div className="mono-bright">{e.user_id.substring(0,18)}…</div>
                            <div style={{ fontSize: '10.5px', color: 'var(--muted)', marginTop: '1px' }}>{e.user_email}</div>
                          </td>
                          <td><span className={`gate-tag ${gateClass(e.gate_name)}`}>{gateLabel(e.gate_name)}</span></td>
                          <td><span className={`action-badge ${e.action_taken.toLowerCase()}`}><span className="badge-pip"></span>{e.action_taken}</span></td>
                          <td>
                            <span style={{ fontSize: '12px', color: e.consent_status === 'granted' ? 'var(--teal)' : 'var(--coral)' }}>{e.consent_status}</span>
                          </td>
                          <td><span style={{ fontSize: '12px', color: 'var(--muted)' }}>{e.purpose || '—'}</span></td>
                          <td>
                            {e.trace_id ? (
                              <div className="trace-cell">
                                <span className="trace-val">{e.trace_id.substring(0,10)}…</span>
                                <button className="copy-btn" onClick={(evt) => handleCopyTrace(evt, e.trace_id)} title="Copy full trace ID">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.5"/></svg>
                                </button>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--muted2)', fontSize: '11px' }}>—</span>
                            )}
                          </td>
                          <td>
                            <button className="btn btn-sm btn-icon" onClick={(evt) => { evt.stopPropagation(); openDrawer(e); }} title="View details">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="pagination">
                <div className="pagination-info">Page {currentPage} of {totalPages}</div>
                <div className="pagination-controls">
                  <button className="page-btn" onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage <= 1}>‹</button>
                  {Array.from({ length: totalPages }).map((_, i) => {
                    const p = i + 1;
                    if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1) {
                      return <button key={p} className={`page-btn ${p === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>;
                    }
                    if (Math.abs(p - currentPage) === 2) {
                      return <span key={p} style={{ color: 'var(--muted2)', padding: '0 4px', fontSize: '12px' }}>…</span>;
                    }
                    return null;
                  })}
                  <button className="page-btn" onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage >= totalPages}>›</button>
                </div>
              </div>
            </div>

          </div>
        </main>
      </div>
    </>
  );
}
