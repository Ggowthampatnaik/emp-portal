/**
 * The picker is shared by the profile editor and both employee filters, so its
 * contract matters more than any one caller: it must hand back the ids the API
 * expects *and* the rows the caller needs to label them.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Skill } from '@/types/domain';

const list = vi.fn();

vi.mock('@/services/api/services', () => ({
  skillsApi: { list: (...args: unknown[]) => list(...args) },
}));

const { default: SkillPicker } = await import('@/components/common/SkillPicker');

function skill(id: number, name: string, category: Skill['category'], label: string): Skill {
  return {
    id,
    name,
    category,
    category_label: label,
    is_active: true,
    employee_count: 0,
  };
}

const VOCABULARY = [
  skill(1, 'React', 'framework', 'Framework or library'),
  skill(2, 'Django', 'framework', 'Framework or library'),
  skill(3, 'PostgreSQL', 'database', 'Database'),
];

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ count: VOCABULARY.length, results: VOCABULARY });
});

async function open(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByRole('combobox', { name: 'Skills' });
  await waitFor(() => expect(input).toBeEnabled());
  await user.click(input);
  return input;
}

describe('SkillPicker', () => {
  it('offers the vocabulary, grouped by category', async () => {
    const user = userEvent.setup();
    render(<SkillPicker value={[]} onChange={vi.fn()} />);

    await open(user);

    expect(screen.getByRole('option', { name: 'React' })).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
  });

  it('reports both the ids and the chosen rows', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SkillPicker value={[]} onChange={onChange} />);

    await open(user);
    await user.click(screen.getByRole('option', { name: 'Django' }));

    expect(onChange).toHaveBeenCalledWith([2], [VOCABULARY[1]]);
  });

  it('adds to the selection rather than replacing it', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SkillPicker value={[1]} onChange={onChange} />);

    await open(user);
    await user.click(screen.getByRole('option', { name: 'PostgreSQL' }));

    expect(onChange).toHaveBeenCalledWith([1, 3], [VOCABULARY[0], VOCABULARY[2]]);
  });

  it('shows what is already selected as chips', async () => {
    render(<SkillPicker value={[1, 3]} onChange={vi.fn()} />);

    expect(await screen.findByText('React')).toBeInTheDocument();
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.queryByText('Django')).not.toBeInTheDocument();
  });

  it('fetches the vocabulary once, not per keystroke', async () => {
    const user = userEvent.setup();
    render(<SkillPicker value={[]} onChange={vi.fn()} />);

    const input = await open(user);
    await user.type(input, 'Rea');

    expect(screen.getByRole('option', { name: 'React' })).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('ignores an id that is not in the vocabulary', async () => {
    render(<SkillPicker value={[99]} onChange={vi.fn()} />);

    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.queryByText('99')).not.toBeInTheDocument();
  });
});
