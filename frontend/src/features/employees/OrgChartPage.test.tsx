/**
 * The reporting tree.
 *
 * jsdom has no layout, so the elbow connectors cannot be measured. What can be
 * pinned is everything they are drawn *from*: who appears, who is nested under
 * whom, what a collapsed branch admits to hiding, and that "expand all"
 * overrides a branch somebody had shut by hand — the case where a per-node
 * toggle and a global command disagree.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import { makeUser } from '@/test/fixtures';
import type { OrgNode } from '@/types/domain';

const orgChart = vi.fn();
const directoryEntry = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    orgChart: (...args: unknown[]) => orgChart(...args),
    directoryEntry: (...args: unknown[]) => directoryEntry(...args),
  },
}));

const { default: OrgChartPage } = await import('@/features/employees/OrgChartPage');

function person(
  id: number,
  full_name: string,
  designation: string | null,
  reports: OrgNode[] = [],
): OrgNode {
  return {
    id,
    employee_code: `TRG${String(id).padStart(4, '0')}`,
    full_name,
    designation,
    department: 'Engineering',
    photo_url: null,
    reports,
  };
}

/** ceo -> vp -> (dev, qa), plus a second direct report with nobody under them. */
const TREE: OrgNode[] = [
  person(1, 'Sneha Kulkarni', 'Chief Executive', [
    person(4, 'Vikram Nair', 'Engineering Manager', [
      person(5, 'Asha Rao', 'Software Engineer'),
      person(6, 'Karthik Reddy', 'QA Engineer'),
    ]),
    person(2, 'Priya Menon', 'HR Manager'),
  ]),
];

function renderPage() {
  // An ordinary employee: the person a link to the full record used to fail.
  const store = createStore();
  store.dispatch(
    setUser(makeUser({ roles: ['employee'], permissions: ['employee.view_self'] })),
  );
  render(
    <Provider store={store}>
      <MemoryRouter>
        <OrgChartPage />
      </MemoryRouter>
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  orgChart.mockResolvedValue(TREE);
});

describe('OrgChartPage', () => {
  it('counts everyone in the company', async () => {
    renderPage();

    expect(await screen.findByText(/5 people in the company/i)).toBeInTheDocument();
  });

  it('shows the top of the tree and their direct reports', async () => {
    renderPage();

    expect(await screen.findByText('Sneha Kulkarni')).toBeInTheDocument();
    expect(screen.getByText('Vikram Nair')).toBeInTheDocument();
    expect(screen.getByText('Priya Menon')).toBeInTheDocument();
  });

  it('shows each person their job title', async () => {
    renderPage();

    expect(await screen.findByText('Chief Executive')).toBeInTheDocument();
    expect(screen.getByText('Engineering Manager')).toBeInTheDocument();
  });

  it('keeps deeper levels folded away until asked', async () => {
    renderPage();

    await screen.findByText('Vikram Nair');
    expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
  });

  it('says how many a collapsed branch is hiding', async () => {
    renderPage();

    // Vikram has two directs and nobody below them, so the branch is just those
    // two and the button does not repeat itself.
    expect(await screen.findByRole('button', { name: /2 reports/i })).toBeInTheDocument();
  });

  it('opens a branch when its own control is used', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /2 reports/i }));

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Karthik Reddy')).toBeInTheDocument();
  });

  it('nests reports inside their manager rather than beside them', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /2 reports/i }));

    // Asha sits inside Vikram's subtree; the DOM nesting is what the connectors
    // are drawn from, so it is the thing worth asserting.
    const vikram = (await screen.findByText('Vikram Nair')).closest('div')!.parentElement!
      .parentElement!.parentElement!;
    expect(within(vikram).getByText('Asha Rao')).toBeInTheDocument();
  });

  it('expands the whole tree at once', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /expand all/i }));

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Karthik Reddy')).toBeInTheDocument();
  });

  it('collapses the whole tree at once', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /expand all/i }));
    await screen.findByText('Asha Rao');
    await user.click(screen.getByRole('button', { name: /collapse all/i }));

    await waitFor(() => expect(screen.queryByText('Vikram Nair')).not.toBeInTheDocument());
  });

  it('lets a global command override a branch shut by hand', async () => {
    const user = userEvent.setup();
    renderPage();

    // Shut the CEO's branch, then ask for everything.
    await user.click(await screen.findByRole('button', { name: /hide reports/i }));
    await waitFor(() => expect(screen.queryByText('Vikram Nair')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /expand all/i }));

    expect(await screen.findByText('Vikram Nair')).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
  });

  it("opens a person's details over the chart, not their full record", async () => {
    const user = userEvent.setup();
    directoryEntry.mockResolvedValue({
      id: 1,
      employee_code: 'TRG0001',
      full_name: 'Sneha Kulkarni',
      email: 'sneha.kulkarni@trigyan.io',
      designation_name: 'Chief Executive',
      department_name: 'Engineering',
      photo_url: null,
      reporting_manager: null,
      reporting_manager_name: null,
      phone: '',
      direct_reports: [],
    });
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Sneha Kulkarni' }));

    const dialog = await screen.findByRole('dialog');
    expect(directoryEntry).toHaveBeenCalledWith(1);
    expect(await within(dialog).findByText('sneha.kulkarni@trigyan.io')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sneha Kulkarni' })).not.toBeInTheDocument();
  });

  it('says so when there is nothing to chart', async () => {
    orgChart.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/nothing to chart yet/i)).toBeInTheDocument();
  });

  it('flags when the tree has more than one top-level person', async () => {
    orgChart.mockResolvedValue([
      person(1, 'Sneha Kulkarni', 'CEO'),
      person(9, 'Ravi Kumar', 'Contractor'),
    ]);
    renderPage();

    expect(await screen.findByText(/2 top-level people/i)).toBeInTheDocument();
  });

  it('leaves someone with no manager and no reports off the chart', async () => {
    orgChart.mockResolvedValue([
      person(1, 'Sneha Kulkarni', 'Director', [person(2, 'Rahul Iyer', 'Manager')]),
      person(3, 'Gowtham G', null),
    ]);
    renderPage();

    await screen.findByText('Rahul Iyer');

    expect(screen.queryByText('Gowtham G')).not.toBeInTheDocument();
    expect(screen.queryByText(/No manager assigned/)).not.toBeInTheDocument();
    expect(screen.queryByText(/top-level people/i)).not.toBeInTheDocument();
    expect(screen.getByText(/2 people in the company/)).toBeInTheDocument();
  });

  const card = (name: string) => screen.getByText(name).closest('.MuiPaper-root')!;

  it('stacks reports with nobody under them, without the empty toggle row', async () => {
    orgChart.mockResolvedValue([
      person(1, 'Vikram Nair', 'Manager', [
        person(2, 'Asha Rao', 'Engineer'),
        person(3, 'Karthik Reddy', 'Engineer'),
      ]),
    ]);
    renderPage();

    await screen.findByText('Asha Rao');

    expect(card('Asha Rao').querySelector('.MuiButton-root')).toBeNull();
    expect(card('Karthik Reddy').querySelector('.MuiButton-root')).toBeNull();
  });

  it('stacks them beside a colleague who has a team', async () => {
    orgChart.mockResolvedValue([
      person(1, 'Sneha Kulkarni', 'Director', [
        person(2, 'Rahul Iyer', 'Manager', [person(4, 'Meera Joshi', 'Lead')]),
        person(3, 'Rohan Desai', 'Manager'),
        person(5, 'Rao Adapa', 'Manager'),
      ]),
    ]);
    renderPage();

    await screen.findByText('Rohan Desai');

    expect(card('Rahul Iyer').querySelector('.MuiButton-root')).not.toBeNull();
    expect(card('Rohan Desai').querySelector('.MuiButton-root')).toBeNull();
    expect(card('Rao Adapa').querySelector('.MuiButton-root')).toBeNull();
  });

  it('keeps one person beside a colleague in the row, the same height', async () => {
    orgChart.mockResolvedValue([
      person(1, 'Sneha Kulkarni', 'Director', [
        person(2, 'Rahul Iyer', 'Manager', [person(4, 'Meera Joshi', 'Lead')]),
        person(3, 'Rohan Desai', 'Manager'),
      ]),
    ]);
    renderPage();

    await screen.findByText('Rohan Desai');

    expect(card('Rohan Desai').querySelector('.MuiButton-root')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('offers a retry when the tree cannot be loaded', async () => {
    orgChart.mockRejectedValue({
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
  it('reserves the toggle row on a card with nobody under it', async () => {
    // A leaf card used to be a button-row shorter than the manager beside it,
    // so a line of siblings came out ragged. The row is now always there.
    renderPage();

    // Priya has nobody under them, beside Vikram who does.
    const leaf = (await screen.findByText('Priya Menon')).closest('.MuiPaper-root');
    const manager = screen.getByText('Vikram Nair').closest('.MuiPaper-root');

    expect(leaf).not.toBeNull();
    expect(manager).not.toBeNull();
    // Present in the layout, absent from the accessibility tree, and inert.
    const spacer = leaf!.querySelector('.MuiButton-root');
    expect(spacer).not.toBeNull();
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(spacer).toHaveAttribute('tabindex', '-1');
    expect(spacer).toHaveStyle({ visibility: 'hidden' });
    // ...and it is not offered as something to press.
    expect(
      within(leaf as HTMLElement).queryByRole('button', { name: /report/i }),
    ).not.toBeInTheDocument();
    expect(
      within(manager as HTMLElement).getByRole('button', { name: /report/i }),
    ).toBeInTheDocument();
  });
  it('holds the department line open on a card that has none', async () => {
    orgChart.mockResolvedValue([
      person(1, 'Sneha Kulkarni', 'Director', [
        { ...person(9, 'Gowtham G', null), department: null },
      ]),
    ]);
    renderPage();

    // The root's branch is open by default, so Gowtham is already on screen.
    const card = (await screen.findByText('Gowtham G')).closest('.MuiPaper-root');
    const withDept = screen.getByText('Sneha Kulkarni').closest('.MuiPaper-root');

    // Both cards carry the same three lines, so they come out the same height.
    expect(within(card as HTMLElement).getByText('No department')).toHaveStyle({
      visibility: 'hidden',
    });
    expect(within(withDept as HTMLElement).getByText('Engineering')).toBeVisible();
  });
});
