import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';

export interface HealthResponse {
  status: string;
  postgres: string;
  redis: string;
  kafka?: string;
  otel?: string;
}

export function useHealthStatus() {
  return useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await api.get('/health');
      return res.data;
    },
    refetchInterval: 30000,
  });
}
