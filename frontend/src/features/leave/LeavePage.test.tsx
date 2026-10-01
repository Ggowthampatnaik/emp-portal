/**
 * Which approval queues each role is offered.
 *
 * HR works the second stage only: it confirms a request or sends it back, and
 * it never rejects. So the manager's queue — the one place a Reject button
 * exists — is not shown to HR at all, and a Reject button must not be reachable
 * from anywhere HR can get to.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';
import type { PermissionCode } from '@/types/auth';

const pendingApprovals = vi.fn();
const hrApprovals = vi.fn();

vi.mock('@/services/api/services', () => ({
  leaveApi: {
    pendingApprovals: (...args: unknown[]) => pendingApprovals(...args),
    hrApprovals: (...args: unknown[]) => hrApprovals(...args),
    myBalances: () => Promise.resolve([]),
    mine: () => Promise.resolve({ count: 0, results: [] }),
    types: () => Promise.resolve({ count: 0, results: [] }),
    holidays: () => Promise.resolve({ count: 0, results: [] }),
    apply: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    sendBack: vi.fn(),
    cancel: vi.fn(),
  },
}));

const { default: LeavePage } = await import('@/features/leave/LeavePage');

const EMPLOYEE: PermissionCode[] = ['leave.apply', 'leave.view_self'];
const MANAGER: PermissionCode[] = [...EMPLOYEE, 'leave.view_team', 'leave.approve'];
const HR: PermissionCode[] = [...EMPLOYEE, 'leave.view_all', 'leave.approve'];

function renderAs(permissions: PermissionCode[], path = '/leave') {
  const store = createStore({
    auth: { user: makeUser({ permissions }), status: 'authenticated', error: null } as never,
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <LeavePage />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  pendingApprovals.mockResolvedValue({ count: 2, results: [] });
  hrApprovals.mockResolvedValue({ count: 1, results: [] });
});

describe('LeavePage tabs', () => {
  it('gives a plain employee neither queue', async () => {
    renderAs(EMPLOYEE);

    expect(await screen.findByRole('tab', { name: /my balances/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /manager approvals/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /hr approvals/i })).not.toBeInTheDocument();
  });

  it('gives a manager the manager queue only', async () => {
    renderAs(MANAGER);

    expect(await screen.findByRole('tab', { name: /manager approvals/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /hr approvals/i })).not.toBeInTheDocument();
  });

  it('gives HR the HR queue and not the manager one', async () => {
    renderAs(HR);

    expect(await screen.findByRole('tab', { name: /hr approvals/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /manager approvals/i })).not.toBeInTheDocument();
  });

  it('does not even fetch the manager queue for HR', async () => {
    renderAs(HR);

    await waitFor(() => expect(hrApprovals).toHaveBeenCalled());
    expect(pendingApprovals).not.toHaveBeenCalled();
  });

  it('still fetches it for a manager', async () => {
    renderAs(MANAGER);

    await waitFor(() => expect(pendingApprovals).toHaveBeenCalled());
    expect(hrApprovals).not.toHaveBeenCalled();
  });
});

describe('LeavePage, arriving from an approval link', () => {
  /** The dashboard card and every approval notification point at this path. */
  it('opens HR on their own queue, not on My balances', async () => {
    renderAs(HR, '/leave/approvals');

    const tab = await screen.findByRole('tab', { name: /hr approvals/i });
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tab', { name: /my balances/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('opens a manager on the manager queue', async () => {
    renderAs(MANAGER, '/leave/approvals');

    const tab = await screen.findByRole('tab', { name: /manager approvals/i });
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
  });

  it('opens My requests from the Open leave requests card', async () => {
    renderAs(HR, '/leave/requests');

    const tab = await screen.findByRole('tab', { name: /my requests/i });
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('tab', { name: /my balances/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('opens My requests for a plain employee too', async () => {
    renderAs(EMPLOYEE, '/leave/requests');

    const tab = await screen.findByRole('tab', { name: /my requests/i });
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
  });

  it('still opens My balances at /leave', async () => {
    renderAs(HR);

    const tab = await screen.findByRole('tab', { name: /my balances/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back to the first tab for somebody with no queue', async () => {
    renderAs(EMPLOYEE, '/leave/approvals');

    const tab = await screen.findByRole('tab', { name: /my balances/i });
    expect(tab).toHaveAttribute('aria-selected', 'true');
  });
});
