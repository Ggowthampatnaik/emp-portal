/**
 * Minimal data-fetching hooks.
 *
 * The app has no server-state library, so these two cover the whole surface:
 * `useApiResource` for reads (with reload) and `useApiAction` for writes (with
 * a busy flag and a normalised error). Both cancel their state updates on
 * unmount so a slow response cannot write into a dead component.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { toApiError } from '@/services/api/client';
import type { ApiError } from '@/types/api';

interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

export interface Resource<T> extends ResourceState<T> {
  reload: () => Promise<void>;
  setData: (value: T | null) => void;
}

/**
 * Runs `fetcher` on mount and whenever `deps` change.
 * Keep `fetcher` stable (useCallback) or pass its inputs through `deps`.
 */
export function useApiResource<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): Resource<T> {
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    loading: true,
    error: null,
  });
  const alive = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      if (alive.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (alive.current) setState({ data: null, loading: false, error: toApiError(error) });
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((value: T | null) => {
    setState((prev) => ({ ...prev, data: value }));
  }, []);

  return { ...state, reload: load, setData };
}

export interface ActionState {
  busy: boolean;
  error: ApiError | null;
  /** Field-level messages, ready for form helperText. */
  fieldErrors: Record<string, string>;
  clearError: () => void;
}

export interface Action<TArgs extends unknown[], TResult> extends ActionState {
  run: (...args: TArgs) => Promise<TResult | undefined>;
}

/** Wraps a write call with a busy flag and normalised errors. */
export function useApiAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): Action<TArgs, TResult> {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;

  const run = useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await actionRef.current(...args);
    } catch (caught) {
      setError(toApiError(caught));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    run,
    busy,
    error,
    fieldErrors: error?.fieldErrors ?? {},
    clearError: () => setError(null),
  };
}
