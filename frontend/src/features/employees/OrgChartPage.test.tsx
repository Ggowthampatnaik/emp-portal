/**
 * The reporting tree.
 *
 * jsdom has no layout, so the elbow connectors cannot be measured. What can be
 * pinned is everything they are drawn *from*: who appears, who is nested under
 * whom, what a collapsed branch admits to hiding, and that "expand all"
 * overrides a branch somebody had shut by hand — the case where a per-node
 * toggle and a global command disagree.
 */

import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgNode } from '@/types/domain';

const orgChart = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: { orgChart: (...args: unknown[]) => orgChart(...args) },
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
  render(
    <MemoryRouter>
      <OrgChartPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  orgChart.mockResolvedValue(TREE);
});

describe('OrgChartPage', () => {
  it('counts everyone in the visible tree', async () => {
    renderPage();

    expect(
      await screen.findByText(/5 people in your visible reporting tree/i),
    ).toBeInTheDocument();
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

  it('links each person to their profile', async () => {
    renderPage();

    expect(await screen.findByRole('link', { name: 'Sneha Kulkarni' })).toHaveAttribute(
      'href',
      '/employees/1',
    );
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
    const user = userEvent.setup();
    renderPage();

    // Karthik is a leaf under Vikram, so open that branch to see them together.
    await user.click(await screen.findByRole('button', { name: /2 reports/i }));

    const leaf = (await screen.findByText('Karthik Reddy')).closest('.MuiPaper-root');
    const manager = screen.getByText('Vikram Nair').closest('.MuiPaper-root');

    expect(leaf).not.toBeNull();
    expect(manager).not.toBeNull();
    // Present in the layout, absent from the accessibility tree, and inert.
    const spacer = leaf!.querySelector('button');
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
