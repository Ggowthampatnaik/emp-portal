/**
 * The expanded project panel, which replaced the separate detail page.
 *
 * Two things it has to get right. Membership and allocation are independent
 * records, so the case that matters is the one where they do not line up:
 * somebody on the team with no active allocation must still be listed, and a
 * lapsed allocation must not be shown as current.
 *
 * And it now carries the staffing controls the deleted page owned — so the
 * permission gating is tested here, because there is nowhere else left to do
 * it from.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';
import type { PermissionCode } from '@/types/auth';
import type { ProjectAllocation, ProjectDetail, ProjectMember } from '@/types/domain';

const detail = vi.fn();
const addMember = vi.fn();
const removeMember = vi.fn();
const addAllocation = vi.fn();
const removeAllocation = vi.fn();
const employeeList = vi.fn();

vi.mock('@/services/api/services', () => ({
  projectsApi: {
    detail: (...args: unknown[]) => detail(...args),
    addMember: (...args: unknown[]) => addMember(...args),
    removeMember: (...args: unknown[]) => removeMember(...args),
    addAllocation: (...args: unknown[]) => addAllocation(...args),
    removeAllocation: (...args: unknown[]) => removeAllocation(...args),
  },
  employeesApi: { list: (...args: unknown[]) => employeeList(...args) },
}));

const { default: ProjectTeamRow } = await import('@/features/projects/ProjectTeamRow');

function member(overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    id: 1,
    project: 3,
    employee: 10,
    employee_code: 'TRG0005',
    employee_name: 'Asha Rao',
    designation: 'Software Engineer',
    role_in_project: 'developer',
    joined_on: '2026-01-06',
    left_on: null,
    is_active: true,
    ...overrides,
  };
}

function allocation(overrides: Partial<ProjectAllocation> = {}): ProjectAllocation {
  return {
    id: 1,
    project: 3,
    project_code: 'PRJ-001',
    project_name: 'Northwind Retail Platform',
    employee: 10,
    employee_code: 'TRG0005',
    employee_name: 'Asha Rao',
    allocation_percentage: '60.00',
    start_date: '2026-01-06',
    end_date: null,
    is_active: true,
    ...overrides,
  };
}

function project(
  members: ProjectMember[],
  allocations: ProjectAllocation[],
): Partial<ProjectDetail> {
  return { id: 3, code: 'PRJ-001', name: 'Northwind Retail Platform', members, allocations };
}

const MANAGER: PermissionCode[] = ['project.view', 'project.assign_team', 'project.allocate'];
const VIEWER: PermissionCode[] = ['project.view'];

function renderRow(permissions: PermissionCode[] = VIEWER) {
  const store = createStore({
    auth: { user: makeUser({ permissions }), status: 'authenticated', error: null } as never,
  });
  render(
    <Provider store={store}>
      <ProjectTeamRow projectId={3} />
    </Provider>,
  );
}

/** The table row for one person, so assertions cannot match a neighbour. */
async function rowFor(name: string) {
  return (await screen.findByText(name)).closest('tr')!;
}

beforeEach(() => {
  vi.clearAllMocks();
  detail.mockResolvedValue(project([member()], [allocation()]));
  employeeList.mockResolvedValue({ count: 0, results: [] });
  addMember.mockResolvedValue({ id: 9, employee_name: 'Karthik Reddy' });
  addAllocation.mockResolvedValue({ id: 9, employee_name: 'Karthik Reddy' });
  removeMember.mockResolvedValue('');
  removeAllocation.mockResolvedValue('');
});

describe('ProjectTeamRow', () => {
  it('fetches the project once rather than members and allocations separately', async () => {
    renderRow();

    await waitFor(() => expect(detail).toHaveBeenCalledWith(3));
    expect(detail).toHaveBeenCalledTimes(1);
  });

  it('lists the assigned employees and their data', async () => {
    renderRow();

    const row = await rowFor('Asha Rao');
    expect(within(row).getByText('TRG0005 · Software Engineer')).toBeInTheDocument();
    expect(within(row).getByText('Developer')).toBeInTheDocument();
    expect(within(row).getByText('60%')).toBeInTheDocument();
  });

  it('does not show a date of joining', async () => {
    renderRow();

    await rowFor('Asha Rao');
    expect(screen.queryByText('Joined')).not.toBeInTheDocument();
    expect(screen.queryByText('2026-01-06')).not.toBeInTheDocument();
  });

  it('lists somebody on the team with no allocation', async () => {
    detail.mockResolvedValue(
      project(
        [member(), member({ id: 2, employee: 11, employee_name: 'Karthik Reddy' })],
        [allocation()],
      ),
    );
    renderRow();

    const row = await rowFor('Karthik Reddy');
    expect(within(row).getByText('Not allocated')).toBeInTheDocument();
  });

  it('does not treat a lapsed allocation as current', async () => {
    detail.mockResolvedValue(
      project([member()], [allocation({ is_active: false, end_date: '2026-03-01' })]),
    );
    renderRow();

    const row = await rowFor('Asha Rao');
    expect(within(row).getByText('Not allocated')).toBeInTheDocument();
    expect(within(row).queryByText('60%')).not.toBeInTheDocument();
  });

  it('labels a role the old table showed as a raw slug', async () => {
    // `qa` and `devops` are real values on the server; the previous copy of
    // these labels had `tester` and `support`, which are not.
    detail.mockResolvedValue(project([member({ role_in_project: 'qa' })], []));
    renderRow();

    const row = await rowFor('Asha Rao');
    expect(within(row).getByText('QA')).toBeInTheDocument();
  });

  it('says so when nobody is assigned', async () => {
    detail.mockResolvedValue(project([], []));
    renderRow();

    expect(await screen.findByText(/nobody is currently assigned/i)).toBeInTheDocument();
  });

  // -- the controls the deleted detail page used to own ----------------------
  it('gives a plain viewer no staffing controls', async () => {
    renderRow();

    await rowFor('Asha Rao');
    expect(screen.queryByRole('button', { name: /add member/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /allocate/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /take .* off the team/i }),
    ).not.toBeInTheDocument();
  });

  it('offers them to somebody who may staff and allocate', async () => {
    renderRow(MANAGER);

    expect(await screen.findByRole('button', { name: /add member/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^allocate$/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /take Asha Rao off the team/i }),
    ).toBeInTheDocument();
  });

  it('separates the two permissions', async () => {
    renderRow(['project.view', 'project.assign_team']);

    expect(await screen.findByRole('button', { name: /add member/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^allocate$/i })).not.toBeInTheDocument();
  });

  it('takes somebody off the team and refreshes', async () => {
    const user = userEvent.setup();
    renderRow(MANAGER);

    await user.click(
      await screen.findByRole('button', { name: /take Asha Rao off the team/i }),
    );

    await waitFor(() => expect(removeMember).toHaveBeenCalledWith(3, 1));
    expect(detail).toHaveBeenCalledTimes(2);
  });

  it('removes an allocation without removing the member', async () => {
    const user = userEvent.setup();
    renderRow(MANAGER);

    await user.click(
      await screen.findByRole('button', { name: /remove Asha Rao's allocation/i }),
    );

    await waitFor(() => expect(removeAllocation).toHaveBeenCalledWith(3, 1));
    expect(removeMember).not.toHaveBeenCalled();
  });

  it('loads the employee picker only when the add dialog opens', async () => {
    const user = userEvent.setup();
    renderRow(MANAGER);

    await screen.findByRole('button', { name: /add member/i });
    expect(employeeList).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /add member/i }));
    await waitFor(() => expect(employeeList).toHaveBeenCalled());
  });

  it('flags an allocation belonging to somebody no longer on the team', async () => {
    detail.mockResolvedValue(
      project([member()], [allocation(), allocation({ id: 2, employee: 99 })]),
    );
    renderRow();

    expect(await screen.findByText(/no longer on the team/i)).toBeInTheDocument();
  });
});
