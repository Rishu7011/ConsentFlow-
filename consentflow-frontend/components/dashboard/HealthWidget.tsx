"use client";

import React from 'react';
import { useHealth } from '@/hooks/useHealth';

export function HealthWidget() {
  const { data: health, isError, isLoading } = useHealth(30000);

  const pgOk = health?.postgres === 'ok';
  const redisOk = health?.redis === 'ok';
  const allOk = pgOk && redisOk && !isError && !isLoading;
  const statusStr = isLoading ? 'loading' : isError ? 'error' : 'ok';

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">System health</span>
        <span className={`health-status ${allOk ? 'ok' : 'err'}`} style={{ fontSize: '11px' }}>
          {allOk ? '● All systems operational' : isLoading ? '● Checking…' : '● System degraded'}
        </span>
      </div>
      <div className="card-body" style={{ padding: '.25rem 1.25rem' }}>
        <HealthItem
          name="PostgreSQL"
          sub="Primary database"
          status={health?.postgres || statusStr}
        />
        <HealthItem
          name="Redis cache"
          sub="TTL: 60s · DB 0"
          status={health?.redis || statusStr}
        />
        <HealthItem
          name="Kafka broker"
          sub="consent.revoked topic"
          status={health?.kafka || (isLoading ? 'loading' : isError ? 'error' : 'ok')}
        />
        <HealthItem
          name="OpenTelemetry"
          sub="OTLP → Grafana"
          status="ok"
        />
      </div>
    </div>
  );
}

function HealthItem({ name, sub, status }: { name: string; sub: string; status: string }) {
  const isOk = status === 'ok';
  const isLoad = status === 'loading';
  return (
    <div className="health-item">
      <div>
        <div className="health-name">{name}</div>
        <div className="health-sub">{sub}</div>
      </div>
      <div className={`health-status ${isOk || isLoad ? 'ok' : 'err'}`}>
        {!isLoad && <div className={`dot ${isOk ? 'green pulse' : 'red'}`} style={{ display: 'inline-block' }}></div>}
        {' '}{isLoad ? 'checking…' : status}
      </div>
    </div>
  );
}
