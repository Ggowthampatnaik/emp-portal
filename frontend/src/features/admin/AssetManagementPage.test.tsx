/** Asset management: who holds what, and issuing more. */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser } from '@/test/fixtures';

const list = vi.fn();
const assets = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    list: (...args: unknown[]) => list(...args),
    assets: (...args: unknown[]) => assets(...args),
    addAsset: vi.fn(),
    updateAsset: vi.fn(),
    removeAsset: vi.fn(),
  },
}));

const { default: AssetManagementPage } = await import('@/features/admin/AssetManagementPage');

function person(id: number, full_name: string, asset_count: number) {
  return {
    id,
    employee_code: `TRG${String(id).padStart(4, '0')}`,
    full_name,
    email: `${id}@trigyan.io`,
    photo_url: null,
    department_name: 'Engineering',
    designation_name: 'Software Engineer',
    employment_status: 'active',
    asset_count,
  };
}

function renderPage() {
  const store = createStore();
  store.dispatch(
    setUser(makeUser({ roles: ['employee', 'admin'], permissions: ['asset.manage'] })),
  );
  render(
    <Provider store={store}>
      <MemoryRouter>
        <AssetManagementPage />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({
    count: 2,
    next: null,
    previous: null,
    results: [person(5, 'Asha Rao', 2), person(6, 'Karthik Reddy', 0)],
  });
  assets.mockResolvedValue([
    {
      id: 1,
      employee: 5,
      name: 'Laptop',
      brand: 'Dell',
      serial_number: 'SN-001',
      photo_url: null,
      issued_on: '2026-01-05',
      condition: 'good',
      created_at: '2026-01-05T00:00:00Z',
      updated_at: '2026-01-05T00:00:00Z',
    },
  ]);
});

describe('AssetManagementPage', () => {
  it('lists active employees with how many assets each holds', async () => {
    renderPage();

    const asha = (await screen.findByText('Asha Rao')).closest('tr')!;
    expect(within(asha).getByText('2')).toBeInTheDocument();
    const karthik = screen.getByText('Karthik Reddy').closest('tr')!;
    expect(within(karthik).getByText('0')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ employment_status: 'active' }));
  });

  it("opens a person's assets from their row", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Asha Rao'));

    expect(await screen.findByText('Laptop')).toBeInTheDocument();
    expect(assets).toHaveBeenCalledWith(5);
  });

  it('issues to someone straight from their row, without opening it', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Issue an asset to Karthik Reddy' }),
    );

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(assets).not.toHaveBeenCalled();
  });

  it('asks who to issue to when issuing from the top', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Issue asset' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Issue to/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('searches as you type', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Asha Rao');
    await user.type(screen.getByPlaceholderText(/Search by name/), 'asha');

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'asha', page: 1 }),
      ),
    );
  });
});
