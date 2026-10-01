/**
 * The four profile list cards show one entry and put the rest in a dialog.
 *
 * A card that grows decides how tall the card beside it has to be, so the cap
 * is what keeps Skills level with Experience and Documents with Assets however
 * much data a person has. Expanding in place would defeat that, which is why
 * "View more" opens a popup rather than unfolding the card.
 *
 * Skills is chips rather than rows, so four of them cost about the height of
 * one Experience row. Documents caps the ordered list rather than each group,
 * so a category heading never appears with nothing under it.
 */

import { Provider } from 'react-redux';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { PROFILE_CHIPS, PROFILE_ROWS } from '@/hooks/useShowMore';

const employeeSkills = vi.fn();
const experience = vi.fn();
const documents = vi.fn();
const assets = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    employeeSkills: (...args: unknown[]) => employeeSkills(...args),
    saveEmployeeSkills: vi.fn(),
    experience: (...args: unknown[]) => experience(...args),
    saveExperience: vi.fn(),
    documents: (...args: unknown[]) => documents(...args),
    removeDocument: vi.fn(),
    uploadDocument: vi.fn(),
    assets: (...args: unknown[]) => assets(...args),
    removeAsset: vi.fn(),
    saveAsset: vi.fn(),
  },
  skillsApi: { list: () => Promise.resolve({ count: 0, results: [] }) },
}));

const { default: SkillsCard } = await import('@/features/employees/SkillsCard');
const { default: ExperienceCard } = await import('@/features/employees/ExperienceCard');
const { default: DocumentsCard } = await import('@/features/employees/DocumentsCard');
const { default: AssetsCard } = await import('@/features/employees/AssetsCard');

function show(ui: React.ReactElement) {
  render(<Provider store={createStore()}>{ui}</Provider>);
}

const many = <T,>(count: number, build: (index: number) => T): T[] =>
  Array.from({ length: count }, (_, index) => build(index));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Experience card', () => {
  const roles = (count: number) =>
    many(count, (index) => ({
      id: index + 1,
      job_title: `Role ${index + 1}`,
      company_name: 'Northwind',
      from_date: '2020-01-01',
      to_date: '2021-01-01',
      is_current: false,
    }));

  it(`shows ${PROFILE_ROWS} role and keeps the rest for the dialog`, async () => {
    experience.mockResolvedValue(roles(4));
    show(<ExperienceCard employeeId={10} canEdit={false} />);

    expect(await screen.findByText('Role 1')).toBeInTheDocument();
    expect(screen.queryByText('Role 2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View all roles/i })).toBeInTheDocument();
  });

  it('opens a dialog with every role, and closes again', async () => {
    const user = userEvent.setup();
    experience.mockResolvedValue(roles(4));
    show(<ExperienceCard employeeId={10} canEdit={false} />);

    await user.click(await screen.findByRole('button', { name: /View all roles/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Role 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Role 4')).toBeInTheDocument();

    // Two controls say Close - the title's X and the footer button.
    await user.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!);
    // The dialog animates out, so wait for it rather than asserting at once.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The card is back to one row, so its height never changed.
    expect(screen.queryByText('Role 4')).not.toBeInTheDocument();
  });

  it('offers no button when the one entry is all there is', async () => {
    experience.mockResolvedValue(roles(1));
    show(<ExperienceCard employeeId={10} canEdit={false} />);

    expect(await screen.findByText('Role 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View all/i })).not.toBeInTheDocument();
  });
});

describe('Assets card', () => {
  it('shows one item and opens the rest in a dialog', async () => {
    const user = userEvent.setup();
    assets.mockResolvedValue(
      many(4, (index) => ({
        id: index + 1,
        name: `Device ${index + 1}`,
        brand: 'Dell',
        serial_number: `SN${index}`,
        photo_url: null,
        issued_on: null,
        condition: '',
      })),
    );
    show(<AssetsCard employeeId={10} canManage={false} />);

    expect(await screen.findByText('Device 1')).toBeInTheDocument();
    expect(screen.queryByText('Device 2')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /View all items/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Device 4')).toBeInTheDocument();
  });
});

describe('Skills card', () => {
  it(`shows ${PROFILE_CHIPS} chips and opens the rest in a dialog`, async () => {
    const user = userEvent.setup();
    employeeSkills.mockResolvedValue(
      many(9, (index) => ({
        id: index + 1,
        skill: index + 1,
        skill_name: `Skill ${index + 1}`,
        proficiency: 'intermediate',
        years_of_experience: null,
      })),
    );
    show(<SkillsCard employeeId={10} canEdit={false} />);

    expect(await screen.findByText(`Skill ${PROFILE_CHIPS}`)).toBeInTheDocument();
    expect(screen.queryByText(`Skill ${PROFILE_CHIPS + 1}`)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /View all skills/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Skill 9')).toBeInTheDocument();
  });
});

describe('Documents card', () => {
  const files = () => [
    {
      id: 1,
      title: 'Paper 1',
      document_type: 'tenth',
      file_url: '/x',
      file_size: 24,
      uploaded_by_name: 'HR',
      uploaded_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 2,
      title: 'Paper 2',
      document_type: 'bachelors',
      file_url: '/x',
      file_size: 24,
      uploaded_by_name: 'HR',
      uploaded_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 3,
      title: 'Paper 3',
      document_type: 'bachelors',
      file_url: '/x',
      file_size: 24,
      uploaded_by_name: 'HR',
      uploaded_at: '2026-01-01T00:00:00Z',
    },
  ];

  it('shows one document and no heading over an empty category', async () => {
    documents.mockResolvedValue(files());
    show(<DocumentsCard employeeId={10} canManage={false} />);

    // The 10th certificate is the first category, so it is the one that shows.
    expect(await screen.findByText('Paper 1')).toBeInTheDocument();
    expect(screen.queryByText('Paper 2')).not.toBeInTheDocument();
    // ...and the Bachelor's heading is not printed with nothing under it.
    expect(screen.queryByText(/bachelor/i)).not.toBeInTheDocument();
  });

  it('opens every document, under its heading, in the dialog', async () => {
    const user = userEvent.setup();
    documents.mockResolvedValue(files());
    show(<DocumentsCard employeeId={10} canManage={false} />);

    await user.click(await screen.findByRole('button', { name: /View all documents/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Paper 1')).toBeInTheDocument();
    expect(within(dialog).getByText('Paper 3')).toBeInTheDocument();
  });
});
