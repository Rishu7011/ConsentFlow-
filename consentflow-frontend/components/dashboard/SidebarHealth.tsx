"use client";

import React from 'react';
import { useHealthStatus } from '@/hooks/useHealthStatus';

export function SidebarHealth() {
  const { data: health, isError, isLoading } = useHealthStatus();

  const getStatus = (serviceStatus?: string) => {
    if (isLoading) return 'loading';
    if (isError) return 'error';
    return serviceStatus || 'ok';
  };

  const pgStatus = getStatus(health?.postgres);
  const redisStatus = getStatus(health?.redis);
  const kafkaStatus = getStatus(health?.kafka);
  const otelStatus = getStatus(health?.otel);

  const getDot = (status: string) => {
    if (status === 'loading') return null;
    return <div className={`dot ${status === 'ok' ? 'green pulse' : 'red'}`} style={{ display: 'inline-block', marginRight: '8px' }}></div>;
  };

  return (
    <div className="sidebar-footer">
      <div className={`status-row ${pgStatus !== 'ok' && pgStatus !== 'loading' ? 'err' : ''}`} style={{ color: pgStatus !== 'ok' && pgStatus !== 'loading' ? 'var(--accent3)' : 'inherit' }}>
        {getDot(pgStatus)}PostgreSQL — {pgStatus}
      </div>
      <div className={`status-row ${redisStatus !== 'ok' && redisStatus !== 'loading' ? 'err' : ''}`} style={{ color: redisStatus !== 'ok' && redisStatus !== 'loading' ? 'var(--accent3)' : 'inherit' }}>
        {getDot(redisStatus)}Redis — {redisStatus}
      </div>
      <div className={`status-row ${kafkaStatus !== 'ok' && kafkaStatus !== 'loading' ? 'err' : ''}`} style={{ color: kafkaStatus !== 'ok' && kafkaStatus !== 'loading' ? 'var(--accent3)' : 'inherit' }}>
        {getDot(kafkaStatus)}Kafka — {kafkaStatus}
      </div>
      <div className={`status-row ${otelStatus !== 'ok' && otelStatus !== 'loading' ? 'err' : ''}`} style={{ color: otelStatus !== 'ok' && otelStatus !== 'loading' ? 'var(--accent3)' : 'inherit' }}>
        {getDot(otelStatus)}Otel — {otelStatus}
      </div>
    </div>
  );
}
