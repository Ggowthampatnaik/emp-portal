/**
 * Axios instance shared by every feature slice.
 *
 * Responsibilities:
 *  - attach the portal JWT
 *  - forward a correlation id that matches the backend X-Request-ID
 *  - refresh the access token once on 401 and replay the original request,
 *    queueing any requests that arrive mid-refresh
 *  - normalise the backend error envelope into a flat ApiError
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios';

import type { ApiError, ApiErrorBody } from '@/types/api';
import { tokenStorage } from '@/services/auth/tokenStorage';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

/** Broadcast when the session cannot be recovered, so the store can log out. */
export const SESSION_EXPIRED_EVENT = 'empportal:session-expired';

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

function correlationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2);
}

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const access = tokenStorage.getAccess();
  if (access) {
    config.headers.Authorization = `Bearer ${access}`;
  }
  config.headers['X-Request-ID'] = correlationId();
  return config;
});

// --- single-flight token refresh -------------------------------------------
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refresh = tokenStorage.getRefresh();
  if (!refresh) throw new Error('No refresh token available.');

  // Bare axios: the interceptors above must not run for the refresh call.
  const { data } = await axios.post<{ access: string; refresh?: string }>(
    `${API_BASE_URL}/auth/token/refresh/`,
    { refresh },
    { headers: { 'Content-Type': 'application/json' } },
  );

  tokenStorage.setAccess(data.access);
  if (data.refresh) {
    tokenStorage.set({ access: data.access, refresh: data.refresh });
  }
  return data.access;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const config = error.config as RetriableConfig | undefined;
    const isAuthEndpoint = config?.url?.includes('/auth/token/refresh');

    if (error.response?.status === 401 && config && !config._retry && !isAuthEndpoint) {
      config._retry = true;
      try {
        refreshPromise ??= refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
        const access = await refreshPromise;
        config.headers.Authorization = `Bearer ${access}`;
        return apiClient(config);
      } catch {
        tokenStorage.clear();
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
    }

    return Promise.reject(toApiError(error));
  },
);

/** True when a value has already been through `toApiError`. */
function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value &&
    'fieldErrors' in value &&
    'status' in value
  );
}

/** Flattens the backend envelope so callers never dig through response.data.error. */
export function toApiError(error: unknown): ApiError {
  // The response interceptor already rejects with an ApiError, and callers
  // normalise again in their catch blocks. Without this guard the second pass
  // sees a plain object, falls through to the generic branch, and replaces a
  // perfectly good message ("31 August is outside the week beginning 24
  // August") with "An unexpected error occurred."
  if (isApiError(error)) return error;

  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const body = error.response?.data?.error;
    const fieldErrors: Record<string, string> = {};

    for (const [field, messages] of Object.entries(body?.details ?? {})) {
      fieldErrors[field] = Array.isArray(messages) ? messages.join(' ') : String(messages);
    }

    return {
      code: body?.code ?? (error.code === 'ECONNABORTED' ? 'timeout' : 'network_error'),
      message: body?.message ?? error.message ?? 'The request could not be completed.',
      requestId: body?.request_id ?? '-',
      fieldErrors,
      status: error.response?.status ?? 0,
    };
  }

  return {
    code: 'unexpected_error',
    message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    requestId: '-',
    fieldErrors: {},
    status: 0,
  };
}

/** Thin typed helpers so feature code reads as domain calls, not HTTP calls. */
export const http = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.get<T>(url, config).then((r) => r.data),
  post: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    apiClient.post<T>(url, body, config).then((r) => r.data),
  put: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    apiClient.put<T>(url, body, config).then((r) => r.data),
  patch: <T>(url: string, body?: unknown, config?: AxiosRequestConfig) =>
    apiClient.patch<T>(url, body, config).then((r) => r.data),
  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.delete<T>(url, config).then((r) => r.data),
};
