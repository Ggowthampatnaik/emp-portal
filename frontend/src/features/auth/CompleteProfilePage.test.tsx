/**
 * The onboarding wizard — the first screen a new employee ever uses.
 *
 * Two things are worth holding. It must not let someone submit a half-filled
 * form, because the server will refuse it and the person will not know which of
 * three steps was wrong. And it must refresh the session afterwards: the gate
 * is keyed on `profile_completed` in /auth/me, so without that the portal stays
 * shut even though the profile is finished.
 */

import { Provider } from 'react-redux';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';

const me = vi.fn();
const completeProfile = vi.fn();
const navigate = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    me: (...args: unknown[]) => me(...args),
    completeProfile: (...args: unknown[]) => completeProfile(...args),
  },
}));

vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}));

const { default: CompleteProfilePage } = await import('@/features/auth/CompleteProfilePage');

const PROFILE = { id: 10, first_name: 'Asha', full_name: 'Asha Rao' };

function renderPage() {
  render(
    <Provider store={createStore()}>
      <CompleteProfilePage />
    </Provider>,
  );
}

/** Fills one step and moves on. */
async function fillStepOne(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/mobile number/i), '+91 98765 43210');
  await user.type(screen.getByLabelText(/date of birth/i), '1996-04-12');
  await user.click(screen.getByLabelText(/gender/i));
  await user.click(await screen.findByRole('option', { name: 'Female' }));
  await user.click(screen.getByLabelText(/blood group/i));
  await user.click(await screen.findByRole('option', { name: 'O+' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  me.mockResolvedValue(PROFILE);
  completeProfile.mockResolvedValue({ ...PROFILE, profile_completed: true });
});

describe('CompleteProfilePage', () => {
  it('greets the person by name and says why they are here', async () => {
    renderPage();

    expect(await screen.findByText(/Welcome, Asha/)).toBeInTheDocument();
    expect(screen.getByText(/before the portal opens/i)).toBeInTheDocument();
    expect(screen.getByText(/will not be asked again/i)).toBeInTheDocument();
  });

  it('shows the three steps', async () => {
    renderPage();

    expect(await screen.findByText('About you')).toBeInTheDocument();
    expect(screen.getByText('Where you live')).toBeInTheDocument();
    expect(screen.getByText('In an emergency')).toBeInTheDocument();
  });

  it('will not move on from a half-filled step', async () => {
    const user = userEvent.setup();
    renderPage();

    const next = await screen.findByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();

    await user.type(screen.getByLabelText(/mobile number/i), '+91 98765 43210');
    expect(next).toBeDisabled();
  });

  it('walks all three steps and submits everything at once', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByLabelText(/permanent address/i), '12 MG Road, Bengaluru');
    await user.type(screen.getByLabelText(/current address/i), '44 Jubilee Hills, Hyderabad');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByLabelText(/emergency contact name/i), 'Rekha Rao');
    await user.type(screen.getByLabelText(/emergency contact number/i), '+91 98765 11111');
    await user.click(screen.getByRole('button', { name: /finish and open the portal/i }));

    expect(completeProfile).toHaveBeenCalledWith(10, {
      phone: '+91 98765 43210',
      date_of_birth: '1996-04-12',
      gender: 'female',
      blood_group: 'O+',
      permanent_address: '12 MG Road, Bengaluru',
      current_address: '44 Jubilee Hills, Hyderabad',
      emergency_contact_name: 'Rekha Rao',
      emergency_contact_phone: '+91 98765 11111',
    });
  });

  it('opens the portal once it is done', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText(/permanent address/i), 'A');
    await user.type(screen.getByLabelText(/current address/i), 'B');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText(/emergency contact name/i), 'C');
    await user.type(screen.getByLabelText(/emergency contact number/i), 'D');
    await user.click(screen.getByRole('button', { name: /finish and open the portal/i }));

    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('lets someone go back and change an earlier answer', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText(/permanent address/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/mobile number/i)).toHaveValue('+91 98765 43210');
  });

  it('cannot go back from the first step', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('says the emergency contact is private', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText(/permanent address/i), 'A');
    await user.type(screen.getByLabelText(/current address/i), 'B');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText(/nobody else sees this/i)).toBeInTheDocument();
  });
});
