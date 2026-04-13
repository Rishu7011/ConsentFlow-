import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';

export interface HealthResponse {
  status: string;
  postgres: string;
  redis: string;
  kafka?: string;
}

export function useHealth(refetchInterval = 30000) {
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await api.get<HealthResponse>('/health');
      return res.data;
    },
    refetchInterval,
    // Don't throw — return degraded state on error
    retry: 1,
  });
}
