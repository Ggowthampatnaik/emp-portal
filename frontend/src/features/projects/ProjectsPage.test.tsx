/**
 * Arriving from the dashboard's "Active projects" card.
 *
 * The card counts active projects, so the page it opens has to show those and
 * not the whole portfolio - a count of three followed by a list of five reads
 * as a bug. The filter is driven by the address, so a second link works while
 * the page is already open.
 */

import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { makeUser } from '@/test/fixtures';
import type { PermissionCode } from '@/types/auth';

const list = vi.fn();
vi.mock('@/services/api/services', () => ({
  projectsApi: { list: (...args: unknown[]) => list(...args), create: vi.fn() },
  employeesApi: { list: () => Promise.resolve({ count: 0, results: [] }) },
}));

vi.mock('@/features/projects/ProjectTeamRow', () => ({ default: () => null }));

const { default: ProjectsPage } = await import('@/features/projects/ProjectsPage');

const PROJECT = {
  id: 1,
  code: 'PRJ-001',
  name: 'Northwind Retail Platform',
  client_name: 'Northwind Traders',
  manager_name: 'Vikram Nair',
  member_count: 4,
  total_allocation: '170.00',
  start_date: '2025-01-06',
  status: 'active',
};

function renderAt(path: string) {
  const store = createStore({
    auth: {
      user: makeUser({ permissions: ['project.view', 'project.view_all'] as PermissionCode[] }),
      status: 'authenticated',
      error: null,
    } as never,
  });
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <ProjectsPage />
      </MemoryRouter>
    </Provider>,
  );
}

/** The status the page asked the API for on its most recent call. */
function askedStatus() {
  return list.mock.calls.at(-1)?.[0]?.status;
}

describe('ProjectsPage status filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue({ count: 1, next: null, previous: null, results: [PROJECT] });
  });

  it('asks only for active projects when opened from the dashboard card', async () => {
    renderAt('/projects?status=active');

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(askedStatus()).toBe('active');
    // ...and the filter says so, so the reader can see why the list is short.
    expect(screen.getByRole('combobox', { name: /status/i })).toHaveTextContent('Active');
  });

  it('asks for every project at plain /projects', async () => {
    renderAt('/projects');

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(askedStatus()).toBeUndefined();
  });

  it('ignores a status that is not one of the options', async () => {
    renderAt('/projects?status=nonsense');

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(askedStatus()).toBeUndefined();
  });

  it('honours any of the other statuses too', async () => {
    renderAt('/projects?status=completed');

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(askedStatus()).toBe('completed');
  });
});
