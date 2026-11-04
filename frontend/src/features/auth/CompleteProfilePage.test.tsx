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
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { latestBirthDateIso } from '@/utils/date';

const me = vi.fn();
const completeProfile = vi.fn();
const navigate = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    me: (...args: unknown[]) => me(...args),
    completeProfile: (...args: unknown[]) => completeProfile(...args),
  },
  // The PIN code directory is out of reach here, so the address is typed in
  // full - which is exactly what the form must still allow.
  addressApi: { lookupPincode: () => Promise.reject(new Error('offline')) },
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
  // The country code has its own box, India by default.
  await user.type(await screen.findByLabelText(/mobile number/i), '98765 43210');
  await user.type(screen.getByLabelText(/date of birth/i), '1996-04-12');
  await user.click(screen.getByLabelText(/gender/i));
  await user.click(await screen.findByRole('option', { name: 'Female' }));
  await user.click(screen.getByLabelText(/blood group/i));
  await user.click(await screen.findByRole('option', { name: 'O+' }));
}

type User = ReturnType<typeof userEvent.setup>;

/** Fills one address, field by field, inside the section with that id prefix. */
async function fillAddress(user: User, prefix: string, address: Record<string, string>) {
  const box = (name: string) => document.getElementById(`${prefix}-${name}`) as HTMLElement;
  await user.type(box('pincode'), address.pincode!);
  await user.type(box('line1'), address.line1!);
  await user.type(box('line2'), address.line2!);
  await user.type(box('city'), address.city!);
  await user.click(
    within(box('state').closest('.MuiFormControl-root') as HTMLElement).getByRole('combobox'),
  );
  await user.click(await screen.findByRole('option', { name: address.state! }));
}

const HOME = {
  pincode: '560001',
  line1: '12 MG Road',
  line2: 'Shivajinagar',
  city: 'Bengaluru',
  state: 'Karnataka',
};
const NOW = {
  pincode: '500033',
  line1: '44 Jubilee Hills',
  line2: 'Road No. 36',
  city: 'Hyderabad',
  state: 'Telangana',
};

/** Step two: a permanent address, and the same one as current. */
async function fillStepTwo(user: User) {
  await fillAddress(user, 'permanent', HOME);
  await user.click(screen.getByRole('checkbox', { name: /same as permanent address/i }));
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

    await user.type(screen.getByLabelText(/mobile number/i), '98765 43210');
    expect(next).toBeDisabled();
  });

  it('walks all three steps and submits everything at once', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await fillAddress(user, 'permanent', HOME);
    await fillAddress(user, 'current', NOW);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.type(screen.getByLabelText(/emergency contact name/i), 'Rekha Rao');
    await user.type(screen.getByLabelText(/emergency contact number/i), '98765 11111');
    await user.click(screen.getByRole('button', { name: /finish and open the portal/i }));

    expect(completeProfile).toHaveBeenCalledWith(10, {
      phone: '+919876543210',
      date_of_birth: '1996-04-12',
      gender: 'female',
      blood_group: 'O+',
      permanent_address_detail: { country: 'IN', landmark: '', ...HOME },
      current_address_detail: { country: 'IN', landmark: '', ...NOW },
      emergency_contact_name: 'Rekha Rao',
      emergency_contact_phone: '+919876511111',
    });
  });

  it('opens the portal once it is done', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await fillStepTwo(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText(/emergency contact name/i), 'C');
    await user.type(screen.getByLabelText(/emergency contact number/i), '80 2345 6789');
    await user.click(screen.getByRole('button', { name: /finish and open the portal/i }));

    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('lets someone go back and change an earlier answer', async () => {
    const user = userEvent.setup();
    renderPage();

    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { name: /permanent address/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText(/mobile number/i)).toHaveValue('9876543210');
    expect(screen.getByLabelText(/country code/i)).toHaveValue('+91');
  });

  it('defaults to India and refuses a number that is not an Indian mobile', async () => {
    const user = userEvent.setup();
    renderPage();

    const mobile = await screen.findByLabelText(/mobile number/i);
    expect(screen.getByLabelText(/country code/i)).toHaveValue('+91');

    await user.type(mobile, '58765 43210'); // Indian mobiles start 6-9
    await user.tab();
    expect(
      screen.getByText(
        'Enter a valid 10-digit Indian mobile number, starting with 6, 7, 8 or 9.',
      ),
    ).toBeInTheDocument();

    await user.clear(mobile);
    await user.type(mobile, '98765');
    await user.tab();
    expect(screen.getByText(/valid 10-digit Indian mobile/)).toBeInTheDocument();
  });

  it('takes another country through the country code picker', async () => {
    const user = userEvent.setup();
    renderPage();

    const code = await screen.findByLabelText(/country code/i);
    await user.clear(code);
    await user.type(code, 'united');
    // Only the matches - countries sharing a dial code (+1, +44) once left
    // stale rows behind, because the list keyed its rows by the code.
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '+971United Arab Emirates',
      '+44United Kingdom',
      '+1United States',
    ]);
    await user.type(code, ' kingdom');
    await user.click(await screen.findByRole('option', { name: /\+44\s*United Kingdom/ }));
    expect(code).toHaveValue('+44');

    const mobile = screen.getByLabelText(/mobile number/i);
    await user.type(mobile, '7400 12');
    await user.tab();
    expect(screen.getByText(/not a valid number for \+44/)).toBeInTheDocument();

    await user.type(mobile, '3456');
    await user.tab();
    expect(screen.queryByText(/not a valid number/)).not.toBeInTheDocument();
  });

  it('will not take a date of birth in the future', async () => {
    const user = userEvent.setup();
    renderPage();

    const dob = await screen.findByLabelText(/date of birth/i);
    // Typing one in is caught, and the step will not move on.
    await fillStepOne(user);
    await user.clear(dob);
    await user.type(dob, '2999-01-01');
    expect(screen.getByText('Date of birth cannot be in the future.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.clear(dob);
    await user.type(dob, '1996-04-12');
    expect(screen.queryByText(/cannot be in the future/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('will not take anyone under 18', async () => {
    const user = userEvent.setup();
    renderPage();

    const dob = await screen.findByLabelText(/date of birth/i);
    // The calendar itself stops 18 years ago today.
    expect(dob).toHaveAttribute('max', latestBirthDateIso());

    // Typing a later date is caught too, and the step will not move on.
    await fillStepOne(user);
    await user.clear(dob);
    await user.type(dob, `${new Date().getFullYear() - 10}-01-01`);
    expect(screen.getByText('An employee must be at least 18 years old.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.clear(dob);
    await user.type(dob, latestBirthDateIso());
    expect(screen.queryByText(/at least 18/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('offers Transgender among the genders', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByLabelText(/gender/i));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(options).toEqual(['Female', 'Male', 'Transgender', 'Prefer not to say']);
  });

  it('asks for each address the way Indian address forms do', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(document.getElementById('permanent-country')).toHaveValue('India');
    for (const label of [
      /^pincode/i,
      /flat, house no\., building, company, apartment/i,
      /area, street, sector, village/i,
      /^landmark/i,
      /town\/city/i,
      /^state/i,
    ]) {
      expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
    }
    expect(document.getElementById('permanent-pincode')).toHaveAttribute(
      'placeholder',
      '6 digits [0-9] PIN code',
    );
  });

  it('takes only a 6-digit PIN code and will not move on without a full address', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const pin = document.getElementById('permanent-pincode') as HTMLInputElement;
    await user.type(pin, '05x60012345');
    expect(pin).toHaveValue('056001'); // digits only, six at most
    await user.tab();
    expect(
      screen.getByText('Enter a 6-digit PIN code (it cannot start with 0).'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.clear(pin);
    await fillStepTwo(user);
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('copies the permanent address when it is also the current one', async () => {
    const user = userEvent.setup();
    renderPage();
    await fillStepOne(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await fillStepTwo(user);

    // The second form goes away; the permanent address is sent for both.
    expect(document.getElementById('current-line1')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.type(screen.getByLabelText(/emergency contact name/i), 'Rekha Rao');
    await user.type(screen.getByLabelText(/emergency contact number/i), '98765 11111');
    await user.click(screen.getByRole('button', { name: /finish and open the portal/i }));

    const body = completeProfile.mock.calls[0]![1];
    expect(body.current_address_detail).toEqual(body.permanent_address_detail);
    expect(body).not.toHaveProperty('permanent_address');
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
    await fillStepTwo(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText(/nobody else sees this/i)).toBeInTheDocument();
  });
});
