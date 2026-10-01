import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { toApiError } from '@/services/api/client';

function axiosErrorWith(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config as never, null, {
    status,
    statusText: '',
    headers: {},
    config: config as never,
    data,
  });
}

describe('toApiError', () => {
  it('flattens the backend error envelope', () => {
    const error = toApiError(
      axiosErrorWith(400, {
        error: {
          code: 'validation_error',
          message: 'The submitted data is invalid.',
          request_id: 'abc123',
          details: { start_date: ['This field is required.'], reason: 'Too long.' },
        },
      }),
    );

    expect(error.code).toBe('validation_error');
    expect(error.status).toBe(400);
    expect(error.requestId).toBe('abc123');
    expect(error.fieldErrors).toEqual({
      start_date: 'This field is required.',
      reason: 'Too long.',
    });
  });

  it('falls back to a network error when there is no response body', () => {
    const error = toApiError(new AxiosError('Network Error', 'ERR_NETWORK'));
    expect(error.code).toBe('network_error');
    expect(error.status).toBe(0);
    expect(error.fieldErrors).toEqual({});
  });

  it('handles non-axios failures', () => {
    const error = toApiError(new Error('boom'));
    expect(error.code).toBe('unexpected_error');
    expect(error.message).toBe('boom');
  });
});

describe('toApiError idempotency', () => {
  it('returns an already-normalised error untouched', () => {
    // The response interceptor rejects with an ApiError, and callers normalise
    // again in their catch blocks. The second pass used to fall through to the
    // generic branch and replace the real message with a generic one.
    const first = toApiError(
      axiosErrorWith(409, {
        error: {
          code: 'business_rule_violation',
          message: '2026-08-31 is outside the week beginning 2026-08-24.',
          request_id: 'abc123',
        },
      }),
    );

    const second = toApiError(first);

    expect(second).toBe(first);
    expect(second.message).toBe('2026-08-31 is outside the week beginning 2026-08-24.');
    expect(second.code).toBe('business_rule_violation');
    expect(second.status).toBe(409);
  });

  it('keeps field errors through a second pass', () => {
    const first = toApiError(
      axiosErrorWith(400, {
        error: {
          code: 'validation_error',
          message: 'The submitted data is invalid.',
          request_id: 'abc123',
          details: { hours: ['Enter a number.'] },
        },
      }),
    );

    expect(toApiError(first).fieldErrors).toEqual({ hours: 'Enter a number.' });
  });
});
