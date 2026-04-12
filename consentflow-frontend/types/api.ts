import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach X-User-ID header when available (for /infer routes)
api.interceptors.request.use((config) => {
  const userId = sessionStorage.getItem('active_user_id');
  if (userId) config.headers['X-User-ID'] = userId;
  return config;
});

export default api;