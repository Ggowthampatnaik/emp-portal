/**
 * HR changes who someone reports to, right where the manager is shown.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { EmployeeDetail, EmployeeListItem } from '@/types/domain';

const update = vi.fn();
const list = vi.fn();
const detail = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    update: (...args: unknown[]) => update(...args),
    list: (...args: unknown[]) => list(...args),
    detail: (...args: unknown[]) => detail(...args),
  },
}));

const { default: ReportingManagerField } =
  await import('@/features/employees/ReportingManagerField');

const SNEHA = {
  id: 1,
  full_name: 'Sneha Kulkarni',
  employee_code: 'TRG0001',
  reporting_manager: null,
  reporting_manager_name: null,
} as unknown as EmployeeDetail;

const VIKRAM = {
  id: 4,
  full_name: 'Vikram Nair',
  employee_code: 'TRG0004',
  photo_url: null,
  designation_name: 'Engineering Manager',
} as unknown as EmployeeListItem;

const onChanged = vi.fn();

function renderField(employee: EmployeeDetail, canManage = true) {
  render(
    <Provider store={createStore()}>
      <ReportingManagerField employee={employee} canManage={canManage} onChanged={onChanged} />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ count: 1, results: [VIKRAM] });
  detail.mockResolvedValue(VIKRAM);
});

describe('ReportingManagerField', () => {
  it('shows the manager, and no Change button without employee.edit', () => {
    renderField(
      { ...SNEHA, reporting_manager: 4, reporting_manager_name: 'Vikram Nair' },
      false,
    );

    expect(screen.getByText('Vikram Nair')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });

  it('lets HR pick a manager and saves just that field', async () => {
    const user = userEvent.setup();
    update.mockResolvedValue({
      ...SNEHA,
      reporting_manager: 4,
      reporting_manager_name: 'Vikram Nair',
    });
    renderField(SNEHA);

    await user.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText(/reporting manager/i));
    await user.click(await screen.findByRole('option', { name: /Vikram Nair/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(update).toHaveBeenCalledWith(1, { reporting_manager: 4 });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('can clear the manager', async () => {
    const user = userEvent.setup();
    update.mockResolvedValue(SNEHA);
    renderField({ ...SNEHA, reporting_manager: 4, reporting_manager_name: 'Vikram Nair' });

    await user.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/reporting manager/i)).toHaveValue(
        'Vikram Nair (TRG0004)',
      ),
    );
    await user.clear(within(dialog).getByLabelText(/reporting manager/i));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(update).toHaveBeenCalledWith(1, { reporting_manager: null });
  });

  it('shows why the server refused a loop, and stays open', async () => {
    const user = userEvent.setup();
    update.mockRejectedValue({
      code: 'invalid',
      message: 'The submitted data is invalid.',
      requestId: 'r1',
      fieldErrors: {
        reporting_manager:
          'That would create a cycle: the chosen manager reports to this employee.',
      },
      status: 400,
    });
    renderField(SNEHA);

    await user.click(screen.getByRole('button', { name: 'Change' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText(/reporting manager/i));
    await user.click(await screen.findByRole('option', { name: /Vikram Nair/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/would create a cycle/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
