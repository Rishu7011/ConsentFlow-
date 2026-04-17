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
    // Retry 3 times with exponential back-off before marking as error
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    // Keep the last successful response visible while a refetch is in progress
    // or after a transient failure — prevents sidebar going all-red on a single blip
    placeholderData: (prev) => prev,
  });
}
