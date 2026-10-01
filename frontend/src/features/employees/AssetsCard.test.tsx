/**
 * The assets section of a profile.
 *
 * The split that matters: seeing kit follows the visibility of the record
 * itself, but issuing, amending and taking it back need `asset.manage`. So an
 * employee looking at their own profile must get the list and none of the
 * controls — a disabled-looking button they can still reach would be a lie the
 * server then has to refuse.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { EmployeeAsset } from '@/types/domain';

const assets = vi.fn();
const addAsset = vi.fn();
const updateAsset = vi.fn();
const removeAsset = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    assets: (...args: unknown[]) => assets(...args),
    addAsset: (...args: unknown[]) => addAsset(...args),
    updateAsset: (...args: unknown[]) => updateAsset(...args),
    removeAsset: (...args: unknown[]) => removeAsset(...args),
  },
}));

const { default: AssetsCard } = await import('@/features/employees/AssetsCard');

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

function renderCard(canManage: boolean) {
  render(
    <Provider store={createStore()}>
      <AssetsCard employeeId={5} canManage={canManage} />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  assets.mockResolvedValue([asset()]);
  addAsset.mockResolvedValue(asset({ id: 2, name: 'Dell U2723' }));
  updateAsset.mockResolvedValue(asset({ brand: 'Apple Inc.' }));
  removeAsset.mockResolvedValue(undefined);
});

describe('AssetsCard', () => {
  it('shows the serial number, name and brand', async () => {
    renderCard(false);

    expect(await screen.findByText('MacBook Pro 14')).toBeInTheDocument();
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('C02XY1234567')).toBeInTheDocument();
  });

  it('gives someone without asset.manage no way to change anything', async () => {
    renderCard(false);

    await screen.findByText('MacBook Pro 14');
    expect(screen.queryByRole('button', { name: /issue asset/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('offers the controls to someone who does have it', async () => {
    renderCard(true);

    expect(await screen.findByRole('button', { name: /issue asset/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('says so plainly when nothing is issued', async () => {
    assets.mockResolvedValue([]);
    renderCard(false);

    expect(await screen.findByText(/nothing is currently issued/i)).toBeInTheDocument();
  });

  it('issues an asset, sending the three details as multipart', async () => {
    const user = userEvent.setup();
    renderCard(true);

    await user.click(await screen.findByRole('button', { name: /issue asset/i }));
    await user.type(screen.getByLabelText(/^name/i), 'Dell U2723');
    await user.type(screen.getByLabelText(/^brand/i), 'Dell');
    await user.type(screen.getByLabelText(/serial number/i), 'CN0ABC1234');
    await user.click(screen.getByRole('button', { name: /^issue asset$/i }));

    await waitFor(() => expect(addAsset).toHaveBeenCalled());
    const [id, form] = addAsset.mock.calls[0] as [number, FormData];
    expect(id).toBe(5);
    expect(form.get('name')).toBe('Dell U2723');
    expect(form.get('brand')).toBe('Dell');
    expect(form.get('serial_number')).toBe('CN0ABC1234');
  });

  it('will not submit without the identifying details', async () => {
    const user = userEvent.setup();
    renderCard(true);

    await user.click(await screen.findByRole('button', { name: /issue asset/i }));
    await user.click(screen.getByRole('button', { name: /^issue asset$/i }));

    expect(addAsset).not.toHaveBeenCalled();
    expect(await screen.findByText(/what is it\?/i)).toBeInTheDocument();
  });

  it('opens the editor with the asset already in it', async () => {
    const user = userEvent.setup();
    renderCard(true);

    await user.click(await screen.findByRole('button', { name: /edit/i }));

    expect(screen.getByLabelText(/^name/i)).toHaveValue('MacBook Pro 14');
    expect(screen.getByLabelText(/serial number/i)).toHaveValue('C02XY1234567');
  });

  it('leaves the photo alone when an edit does not touch it', async () => {
    const user = userEvent.setup();
    renderCard(true);

    await user.click(await screen.findByRole('button', { name: /edit/i }));
    await user.clear(screen.getByLabelText(/^brand/i));
    await user.type(screen.getByLabelText(/^brand/i), 'Apple Inc.');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateAsset).toHaveBeenCalled());
    const form = updateAsset.mock.calls[0][2] as FormData;
    expect(form.get('brand')).toBe('Apple Inc.');
    expect(form.has('photo')).toBe(false);
  });

  it('takes an asset back and refreshes the list', async () => {
    const user = userEvent.setup();
    renderCard(true);

    await user.click(await screen.findByRole('button', { name: /remove/i }));

    await waitFor(() => expect(removeAsset).toHaveBeenCalledWith(5, 1));
    expect(assets).toHaveBeenCalledTimes(2);
  });

  it('renders the photo when there is one', async () => {
    assets.mockResolvedValue([asset({ photo_url: 'https://example.test/laptop.png' })]);
    renderCard(false);

    await screen.findByText('MacBook Pro 14');
    const image = document.querySelector('img[src="https://example.test/laptop.png"]');
    expect(image).not.toBeNull();
  });
});
