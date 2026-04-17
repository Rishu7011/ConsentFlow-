import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/axios';

export interface User {
  id: string;
  email: string;
  created_at: string;
}

// GET /users/{id} — fetch a single user by UUID
export function useUser(userId: string, enabled = true) {
  return useQuery<User>({
    queryKey: ['user', userId],
    queryFn: async () => {
      const res = await api.get<User>(`/users/${userId}`);
      return res.data;
    },
    enabled: enabled && !!userId,
    staleTime: 30000,
    retry: false,
  });
}

// POST /users — register a new user
export function useRegisterUser() {
  return useMutation<User, Error, { email: string }>({
    mutationFn: async ({ email }) => {
      const res = await api.post<User>('/users', { email });
      return res.data;
    },
  });
}

// GET /users — fetch list of all users with consent summaries
export interface UserListRecord {
  id: string;
  email: string;
  created_at: string;
  consents: number;
  status: 'active' | 'revoked' | 'pending';
}

export function useUsers() {
  return useQuery<UserListRecord[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await api.get<UserListRecord[]>('/users');
      return res.data;
    },
    staleTime: 10000,
  });
}
