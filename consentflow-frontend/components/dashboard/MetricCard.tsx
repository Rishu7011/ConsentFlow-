import React from 'react';

interface MetricCardProps {
  label: string;
  value: string | number;
  accent: 'purple' | 'teal' | 'coral' | 'amber';
  delta?: { value: string; up: boolean; text: string };
  secondaryText?: React.ReactNode;
}

export function MetricCard({ label, value, accent, delta, secondaryText }: MetricCardProps) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-val ${accent}`}>{value}</div>
      {delta && (
        <div className="metric-delta">
          <span className={delta.up ? 'delta-up' : 'delta-down'}>{delta.value}</span> {delta.text}
        </div>
      )}
      {secondaryText && (
        <div className="metric-delta">{secondaryText}</div>
      )}
    </div>
  );
}
