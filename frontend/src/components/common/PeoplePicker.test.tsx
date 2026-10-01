/**
 * The picker searches the server as you type, so the things worth pinning are
 * the ones that cost something when wrong: it must not fire a request per
 * keystroke, must not offer someone already chosen, and must hand back the
 * **portal account id** rather than the employment record id — CC is addressed
 * to the account, and the two numbers are different.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersonSearchResult } from '@/types/domain';

const search = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: { search: (...args: unknown[]) => search(...args) },
}));

const { default: PeoplePicker } = await import('@/components/common/PeoplePicker');

function person(id: number, userId: number, name: string, code: string): PersonSearchResult {
  return {
    id,
    user_id: userId,
    employee_code: code,
    full_name: name,
    email: `${name.split(' ')[0]?.toLowerCase()}@trigyan.io`,
    designation_name: 'Software Engineer',
    department_name: 'Engineering',
    photo_url: null,
  };
}

const KARTHIK = person(6, 106, 'Karthik Reddy', 'TRG0006');
const KAVYA = person(9, 109, 'Kavya Menon', 'TRG0009');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  search.mockResolvedValue([KARTHIK, KAVYA]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** userEvent needs to share the fake timer clock. */
function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

describe('PeoplePicker', () => {
  it('waits for two letters before searching', async () => {
    const user = setup();
    render(<PeoplePicker value={[]} onChange={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'k');
    await vi.advanceTimersByTimeAsync(500);

    expect(search).not.toHaveBeenCalled();
  });

  it('floats nothing over the form while it waits', async () => {
    // The dropdown used to open on the first keystroke purely to say "type at
    // least 2 letters" - a box that appears only to announce it has nothing.
    const user = setup();
    render(<PeoplePicker value={[]} onChange={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'k');
    await vi.advanceTimersByTimeAsync(500);

    expect(screen.queryByText(/at least/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument();
  });

  it('still says so when a real search matches nobody', async () => {
    search.mockResolvedValue([]);
    const user = setup();
    render(<PeoplePicker value={[]} onChange={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'zzz');
    await vi.advanceTimersByTimeAsync(500);

    expect(await screen.findByText(/nobody matches/i)).toBeInTheDocument();
  });

  it('searches once for a burst of typing, not once per letter', async () => {
    const user = setup();
    render(<PeoplePicker value={[]} onChange={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'kart');
    await vi.advanceTimersByTimeAsync(500);

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith('kart');
  });

  it('hands back the portal account id, not the employee id', async () => {
    const onChange = vi.fn();
    const user = setup();
    render(<PeoplePicker value={[]} onChange={onChange} />);

    await user.type(screen.getByRole('combobox'), 'kar');
    await vi.advanceTimersByTimeAsync(500);
    await user.click(await screen.findByText('Karthik Reddy'));

    expect(onChange).toHaveBeenCalledWith([KARTHIK]);
    expect(onChange.mock.calls[0][0][0].user_id).toBe(106);
  });

  it('does not offer someone who is already chosen', async () => {
    const user = setup();
    render(<PeoplePicker value={[KARTHIK]} onChange={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'ka');
    await vi.advanceTimersByTimeAsync(500);

    expect(await screen.findByText('Kavya Menon')).toBeInTheDocument();
    // The chip is still there; the *option* is not.
    expect(screen.queryByRole('option', { name: /Karthik Reddy/ })).not.toBeInTheDocument();
  });

  it('shows the chosen people as chips', () => {
    render(<PeoplePicker value={[KARTHIK, KAVYA]} onChange={vi.fn()} />);

    expect(screen.getByText('Karthik Reddy')).toBeInTheDocument();
    expect(screen.getByText('Kavya Menon')).toBeInTheDocument();
  });

  it('says so once the maximum is reached', () => {
    render(<PeoplePicker value={[KARTHIK, KAVYA]} onChange={vi.fn()} max={2} />);

    expect(screen.getByText(/maximum of 2 people/i)).toBeInTheDocument();
  });

  it('survives a failed search without breaking the field', async () => {
    search.mockRejectedValue(new Error('network'));
    const user = setup();
    render(<PeoplePicker value={[]} onChange={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'kar');
    await vi.advanceTimersByTimeAsync(500);

    expect(await screen.findByText(/nobody matches/i)).toBeInTheDocument();
  });
});
