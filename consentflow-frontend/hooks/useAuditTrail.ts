import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';

export interface AuditEntry {
  id: string;
  event_time: string;
  user_id: string;
  gate_name: string;
  action_taken: 'ALLOW' | 'BLOCKED';
  consent_status: string;
  purpose: string | null;
  metadata: Record<string, unknown> | null;
  trace_id: string | null;
}

export interface AuditTrailResponse {
  entries: AuditEntry[];
  total: number;
}

interface AuditFilters {
  user_id?: string;
  gate_name?: string;
  limit?: number;
}

export function useAuditTrail(filters: AuditFilters = {}, refetchInterval = 0) {
  const params = new URLSearchParams();
  if (filters.user_id) params.set('user_id', filters.user_id);
  if (filters.gate_name) params.set('gate_name', filters.gate_name);
  if (filters.limit) params.set('limit', String(filters.limit));

  const qs = params.toString();

  return useQuery<AuditTrailResponse>({
    queryKey: ['audit', filters],
    queryFn: async () => {
      const url = qs ? `/audit?${qs}` : '/audit';
      const res = await api.get<AuditTrailResponse>(url);
      return res.data;
    },
    refetchInterval: refetchInterval || false,
    // Return empty rather than throwing so pages can show graceful empty state
    placeholderData: { entries: [], total: 0 },
  });
}
