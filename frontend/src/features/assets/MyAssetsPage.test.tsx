/**
 * The employee's own asset register.
 *
 * The point of the page is the four details — device name, brand, serial and
 * photo — so those are what is checked. The other thing worth pinning is that
 * it is read-only and scoped: it asks for the signed-in person's own assets and
 * offers no way to add or remove one, because issuing kit is HR's job and the
 * server refuses it here whatever the page renders.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';
import type { EmployeeAsset } from '@/types/domain';

const assets = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: { assets: (...args: unknown[]) => assets(...args) },
}));

const { default: MyAssetsPage } = await import('@/features/assets/MyAssetsPage');

function asset(overrides: Partial<EmployeeAsset> = {}): EmployeeAsset {
  return {
    id: 1,
    employee: 5,
    name: 'MacBook Pro 14',
    brand: 'Apple',
    serial_number: 'C02XY1234567',
    photo_url: null,
    issued_on: null,
    condition: 'good',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function renderPage({ employeeId = 5 }: { employeeId?: number | null } = {}) {
  const store = createStore({
    auth: {
      user: makeUser({ employee_id: employeeId }),
      status: 'authenticated',
      error: null,
      initialising: false,
    } as never,
  });
  render(
    <Provider store={store}>
      <MemoryRouter>
        <MyAssetsPage />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  assets.mockResolvedValue([asset()]);
});

describe('MyAssetsPage', () => {
  it('asks for the signed-in employee, not an id from the URL', async () => {
    renderPage();

    await waitFor(() => expect(assets).toHaveBeenCalledWith(5));
  });

  it('shows the device name, brand and serial number', async () => {
    renderPage();

    expect(await screen.findByText('MacBook Pro 14')).toBeInTheDocument();
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('C02XY1234567')).toBeInTheDocument();
    expect(screen.getByText('Brand')).toBeInTheDocument();
    expect(screen.getByText('Serial number')).toBeInTheDocument();
  });

  it('shows the photo when there is one, linked to the full-size image', async () => {
    assets.mockResolvedValue([asset({ photo_url: 'https://example.test/laptop.png' })]);
    renderPage();

    const image = await screen.findByAltText('MacBook Pro 14');
    expect(image).toHaveAttribute('src', 'https://example.test/laptop.png');
    expect(screen.getByRole('link', { name: /view photo/i })).toHaveAttribute(
      'href',
      'https://example.test/laptop.png',
    );
  });

  it('says so plainly when an asset has no photo', async () => {
    renderPage();

    expect(await screen.findByText('No photo')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view photo/i })).not.toBeInTheDocument();
  });

  it('counts what is held', async () => {
    assets.mockResolvedValue([asset(), asset({ id: 2, serial_number: 'CN0AB98765' })]);
    renderPage();

    expect(await screen.findByText('2 items')).toBeInTheDocument();
  });

  it('says "1 item" rather than "1 items"', async () => {
    renderPage();

    expect(await screen.findByText('1 item')).toBeInTheDocument();
  });

  it('offers no way to add or remove anything', async () => {
    renderPage();

    await screen.findByText('MacBook Pro 14');
    expect(screen.queryByRole('button', { name: /add|issue/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /remove|delete|take back/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('explains an empty register rather than showing a blank page', async () => {
    assets.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/nothing issued to you yet/i)).toBeInTheDocument();
  });

  it('handles an account with no employment record without calling the API', async () => {
    renderPage({ employeeId: null });

    expect(await screen.findByText(/no employee record/i)).toBeInTheDocument();
    expect(assets).not.toHaveBeenCalled();
  });

  it('offers a retry when the request fails', async () => {
    assets.mockRejectedValue({
      code: 'network_error',
      message: 'Network Error',
      requestId: '-',
      fieldErrors: {},
      status: 0,
    });
    renderPage();

    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
