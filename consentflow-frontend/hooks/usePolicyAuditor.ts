import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/axios';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PolicyFinding {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  clause_excerpt: string;
  explanation: string;
  article_reference: string;
}

export interface PolicyScanResult {
  scan_id: string;
  integration_name: string;
  overall_risk_level: 'low' | 'medium' | 'high' | 'critical';
  findings: PolicyFinding[];
  findings_count: number;
  raw_summary: string;
  scanned_at: string;
  policy_url: string | null;
}

export interface PolicyScanListItem {
  scan_id: string;
  integration_name: string;
  overall_risk_level: string;
  findings_count: number;
  scanned_at: string;
}

export interface PolicyScanRequest {
  integration_name: string;
  policy_url?: string;
  policy_text?: string;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/**
 * usePolicyScan — mutation that POSTs to /api/policy and returns a
 * PolicyScanResult. Triggers a new AI-powered scan for the supplied integration.
 */
export function usePolicyScan() {
  return useMutation<PolicyScanResult, Error, PolicyScanRequest>({
    mutationFn: async (payload) => {
      // Use an infinite timeout (0) because local Ollama inference on CPU can take arbitrary amounts of time
      const res = await api.post<PolicyScanResult>('/policy', payload, {
        timeout: 0,
      });
      return res.data;
    },
  });
}

/**
 * usePolicyScans — paginated list of past scans, optionally filtered by
 * risk level. Polls every 10 seconds so the table stays fresh.
 */
export function usePolicyScans(riskFilter?: string) {
  const params = new URLSearchParams();
  params.set('limit', '50');
  params.set('offset', '0');
  if (riskFilter) params.set('risk_level', riskFilter);

  const qs = params.toString();

  return useQuery<PolicyScanListItem[]>({
    queryKey: ['policy-scans', riskFilter],
    queryFn: async () => {
      const url = qs ? `/policy?${qs}` : '/policy';
      const res = await api.get<PolicyScanListItem[]>(url);
      return res.data;
    },
    refetchInterval: 10_000,
    placeholderData: [],
  });
}

/**
 * usePolicyScanDetail — fetches the full PolicyScanResult for a single scan.
 * Query is disabled when scanId is null (e.g. nothing selected yet).
 */
export function usePolicyScanDetail(scanId: string | null) {
  return useQuery<PolicyScanResult>({
    queryKey: ['policy-scan', scanId],
    queryFn: async () => {
      const res = await api.get<PolicyScanResult>(`/policy/${scanId}`);
      return res.data;
    },
    enabled: scanId !== null,
  });
}
