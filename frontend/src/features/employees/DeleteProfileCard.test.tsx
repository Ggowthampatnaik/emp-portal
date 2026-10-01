/**
 * The card HR presses to close an account. The wording is the feature: the
 * requirement calls it "delete", the system deactivates, and a card that
 * promised deletion would be lying to the person pressing it.
 *
 * The other rule worth pinning is that HR asks rather than decides — the button
 * must never read as though pressing it closes the account.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { AccountDeletionRequest } from '@/types/domain';

const deletionRequest = vi.fn();
const requestDeletion = vi.fn();
const withdrawDeletion = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    deletionRequest: (...args: unknown[]) => deletionRequest(...args),
    requestDeletion: (...args: unknown[]) => requestDeletion(...args),
    withdrawDeletion: (...args: unknown[]) => withdrawDeletion(...args),
  },
}));

const { default: DeleteProfileCard } = await import('@/features/employees/DeleteProfileCard');

function made(overrides: Partial<AccountDeletionRequest> = {}): AccountDeletionRequest {
  return {
    id: 1,
    employee: 10,
    employee_code: 'TRG0005',
    employee_name: 'Asha Rao',
    employee_email: 'asha.rao@trigyan.io',
    department_name: 'Engineering',
    designation_name: 'Software Engineer',
    employment_status: 'active',
    reason: 'Resigned; last working day was Friday.',
    status: 'pending',
    is_open: true,
    requested_by: 2,
    requested_by_name: 'Priya Menon',
    requested_at: '2026-08-24T09:00:00Z',
    decided_by_name: null,
    decided_at: null,
    decision_note: '',
    ...overrides,
  };
}

/** What the API layer throws when nobody has ever raised a request. */
function notFound() {
  return Promise.reject({
    code: 'not_found',
    message: 'No closure request has been raised for this employee.',
    requestId: 'req-1',
    fieldErrors: {},
    status: 404,
  });
}

function renderCard(props: Partial<Parameters<typeof DeleteProfileCard>[0]> = {}) {
  render(
    <Provider store={createStore()}>
      <DeleteProfileCard
        employeeId={10}
        employeeName="Asha Rao"
        isActive
        isOwnRecord={false}
        canRequest
        {...props}
      />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  deletionRequest.mockImplementation(notFound);
  requestDeletion.mockResolvedValue(made());
});

describe('DeleteProfileCard', () => {
  it('is hidden from anyone without the permission', async () => {
    renderCard({ canRequest: false });

    await waitFor(() => expect(deletionRequest).not.toHaveBeenCalled());
    expect(screen.queryByText('Account closure')).not.toBeInTheDocument();
  });

  it('is hidden on your own record', async () => {
    renderCard({ isOwnRecord: true });

    await waitFor(() => expect(deletionRequest).not.toHaveBeenCalled());
    expect(screen.queryByText('Account closure')).not.toBeInTheDocument();
  });

  it('says plainly that nothing is deleted', async () => {
    renderCard();

    // "not" is emphasised, so the sentence is split across elements; match on
    // the paragraph that carries the whole of it.
    const sentence = await screen.findByText(/leave, timesheets and payslips are kept/i);
    expect(sentence.textContent).toMatch(/does not delete anything/i);
  });

  it('offers to request closure, not to close', async () => {
    renderCard();

    expect(await screen.findByRole('button', { name: /request closure/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete/i })).not.toBeInTheDocument();
  });

  it('makes clear in the dialog that someone else decides', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /request closure/i }));

    expect(screen.getByText(/you are asking, not closing/i)).toBeInTheDocument();
    expect(screen.getByText(/it cannot be you/i)).toBeInTheDocument();
  });

  it('requires a reason of real length before sending', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /request closure/i }));
    const send = screen.getByRole('button', { name: /send request/i });
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText(/reason/i), 'left');
    expect(send).toBeDisabled();

    await user.type(screen.getByLabelText(/reason/i), ' the company on Friday');
    expect(send).toBeEnabled();

    await user.click(send);
    expect(requestDeletion).toHaveBeenCalledWith(10, 'left the company on Friday');
  });

  it('shows an open request instead of offering another', async () => {
    deletionRequest.mockResolvedValue(made());
    renderCard();

    expect(await screen.findByText(/waiting for an administrator/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /withdraw request/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request closure/i })).not.toBeInTheDocument();
  });

  it('withdraws an open request', async () => {
    deletionRequest.mockResolvedValue(made());
    withdrawDeletion.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /withdraw request/i }));

    expect(withdrawDeletion).toHaveBeenCalledWith(10);
  });

  it('explains a previous refusal and lets HR ask again', async () => {
    deletionRequest.mockResolvedValue(
      made({
        status: 'rejected',
        is_open: false,
        decided_by_name: 'Rahul Iyer',
        decision_note: 'They are transferring, not leaving.',
      }),
    );
    renderCard();

    expect(await screen.findByText(/previous request was declined/i)).toBeInTheDocument();
    expect(screen.getByText(/transferring, not leaving/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request closure/i })).toBeInTheDocument();
  });

  it('offers nothing once the account is already inactive', async () => {
    renderCard({ isActive: false });

    expect(await screen.findByText(/already inactive/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request closure/i })).not.toBeInTheDocument();
  });
});
