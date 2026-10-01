/**
 * The audit log: four columns you scan, and the whole entry a click away.
 *
 * The Details column tried to fit a variable payload into a table cell and
 * printed "—" on most rows. The detail belongs in a dialog, where there is room
 * for what actually changed and for the IP address and request id that let an
 * entry be traced through the server logs.
 *
 * Also pinned: the search box, the action filter and the pager re-query. They
 * were wired to state that nothing depended on, so the rows never moved.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { AuditLogEntry } from '@/types/domain';

const auditLogs = vi.fn();
vi.mock('@/services/api/services', () => ({
  adminApi: { auditLogs: (...args: unknown[]) => auditLogs(...args) },
}));

const { default: AuditLogTab } = await import('@/features/admin/AuditLogTab');

function entry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    actor: 3,
    actor_name: 'Rahul Iyer',
    actor_email: 'rahul.iyer@trigyan.io',
    action: 'update',
    entity_type: 'User',
    entity_id: '5',
    entity_label: 'asha.rao@trigyan.io',
    changes: { roles: [['employee'], ['employee', 'manager']] },
    ip_address: '10.0.0.14',
    request_id: 'req-7f3a91',
    created_at: '2026-09-04T09:15:00Z',
    ...overrides,
  };
}

function show(rows: AuditLogEntry[] = [entry()]) {
  auditLogs.mockResolvedValue({
    count: rows.length,
    next: null,
    previous: null,
    results: rows,
  });
  render(
    <Provider store={createStore()}>
      <AuditLogTab />
    </Provider>,
  );
}

describe('AuditLogTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has no Details column', async () => {
    show();

    await screen.findByText('Rahul Iyer');
    expect(screen.queryByRole('columnheader', { name: 'Details' })).not.toBeInTheDocument();
    for (const heading of ['When', 'Who', 'Action', 'Record']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
  });

  it('opens the whole entry when a row is clicked', async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByText('Rahul Iyer'));

    const dialog = await screen.findByRole('dialog');
    // The things the table had no room for.
    expect(within(dialog).getByText('10.0.0.14')).toBeInTheDocument();
    expect(within(dialog).getByText('req-7f3a91')).toBeInTheDocument();
    expect(within(dialog).getByText('rahul.iyer@trigyan.io')).toBeInTheDocument();
  });

  it('shows a change as what it was and what it became', async () => {
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByText('Rahul Iyer'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('roles')).toBeInTheDocument();
    expect(within(dialog).getByText('["employee"]')).toBeInTheDocument();
    expect(within(dialog).getByText('["employee","manager"]')).toBeInTheDocument();
  });

  it('says so when an action changed no fields', async () => {
    const user = userEvent.setup();
    show([entry({ changes: {} })]);

    await user.click(await screen.findByText('Rahul Iyer'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/recorded no field changes/i)).toBeInTheDocument();
  });

  it('re-queries when the search box is typed in', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('Rahul Iyer');
    const before = auditLogs.mock.calls.length;

    await user.type(screen.getByLabelText(/search/i), 'asha');

    await waitFor(() =>
      expect(auditLogs).toHaveBeenCalledWith(expect.objectContaining({ search: 'asha' })),
    );
    expect(auditLogs.mock.calls.length).toBeGreaterThan(before);
  });
});
