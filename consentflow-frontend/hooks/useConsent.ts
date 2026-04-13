import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/axios';

export type ConsentStatus = 'granted' | 'revoked';

export interface ConsentRecord {
  id: string;
  user_id: string;
  data_type: string;
  purpose: string;
  status: ConsentStatus;
  updated_at: string;
  cached?: boolean;
}

interface UpsertConsentPayload {
  user_id: string;
  data_type: string;
  purpose: string;
  status: ConsentStatus;
}

interface RevokeConsentPayload {
  user_id: string;
  purpose: string;
}

// GET /consent/{userId}/{purpose} — check status (on-demand, no auto-poll)
export function useConsentStatus(userId: string, purpose: string, enabled = false) {
  return useQuery<ConsentRecord>({
    queryKey: ['consent', userId, purpose],
    queryFn: async () => {
      const res = await api.get<ConsentRecord>(`/consent/${userId}/${purpose}`);
      return res.data;
    },
    enabled: enabled && !!userId && !!purpose,
    staleTime: 0,
  });
}

// POST /consent — upsert
export function useUpsertConsent() {
  const qc = useQueryClient();
  return useMutation<ConsentRecord, Error, UpsertConsentPayload>({
    mutationFn: async (payload) => {
      const res = await api.post<ConsentRecord>('/consent', payload);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['consent', variables.user_id] });
    },
  });
}

// POST /consent/revoke
export function useRevokeConsent() {
  const qc = useQueryClient();
  return useMutation<ConsentRecord, Error, RevokeConsentPayload>({
    mutationFn: async (payload) => {
      const res = await api.post<ConsentRecord>('/consent/revoke', payload);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['consent', variables.user_id] });
    },
  });
}
