import axios from 'axios';

// ── Centralized Axios instance ──────────────────────────────────────────────
// All frontend API calls go through Next.js proxy routes (/api/...)
// to avoid CORS issues. The proxy routes forward to FastAPI at localhost:8000.
//
// Exception: direct calls to the FastAPI backend for health check polling
// can still work if CORS is configured, but proxying is more reliable.
// ────────────────────────────────────────────────────────────────────────────

const api = axios.create({
  // Use relative path so requests go through Next.js API routes
  // which proxy to the FastAPI backend at localhost:8000
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

// Attach X-User-ID header from sessionStorage on every request
// (used by ConsentMiddleware on /infer/predict)
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const userId = sessionStorage.getItem('active_user_id');
    if (userId && config.headers) {
      config.headers['X-User-ID'] = userId;
    }
  }
  return config;
});

// Global response interceptor — auto-toast on 500/503
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (typeof window !== 'undefined' && (status === 500 || status === 503)) {
      // Dispatch a custom event so any toast listener can pick it up
      window.dispatchEvent(
        new CustomEvent('api:error', {
          detail: {
            status,
            message:
              status === 503
                ? 'Consent engine unavailable'
                : 'Server error — try again',
          },
        })
      );
    }
    return Promise.reject(error);
  }
);

export default api;
