/**
 * Typing an Indian PIN code fills in the town and state, and offers the PIN
 * code's localities - without ever standing in the way of typing it all.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, type AxiosResponse } from 'axios';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_ADDRESS, type AddressDetail } from '@/utils/address';

const lookupPincode = vi.fn();

vi.mock('@/services/api/services', () => ({
  addressApi: { lookupPincode: (...args: unknown[]) => lookupPincode(...args) },
}));

const { default: AddressFields } = await import('@/components/common/AddressFields');

let latest: AddressDetail = EMPTY_ADDRESS;

function Harness({ start = EMPTY_ADDRESS }: { start?: AddressDetail }) {
  const [value, setValue] = useState(start);
  latest = value;
  return <AddressFields idPrefix="home" value={value} onChange={setValue} />;
}

const box = (name: string) => document.getElementById(`home-${name}`) as HTMLInputElement;

function notFound() {
  return new AxiosError('Not found', '404', undefined, undefined, {
    status: 404,
  } as AxiosResponse);
}

beforeEach(() => {
  vi.clearAllMocks();
  lookupPincode.mockResolvedValue({
    pincode: '531081',
    city: 'Visakhapatnam',
    state: 'Andhra Pradesh',
    states: ['Andhra Pradesh'],
    areas: ['Bodugullam Agraharam', 'Chandanada', 'Ch Laxmipuram'],
  });
});

describe('AddressFields - PIN code lookup', () => {
  it('fills in the town and state once six digits are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box('pincode'), '53108');
    expect(lookupPincode).not.toHaveBeenCalled(); // not before the sixth digit

    await user.type(box('pincode'), '1');
    expect(lookupPincode).toHaveBeenCalledWith('531081');
    await waitFor(() => expect(box('city')).toHaveValue('Visakhapatnam'));
    expect(latest.state).toBe('Andhra Pradesh');
    expect(
      screen.getByText('Filled in from the PIN code: Visakhapatnam, Andhra Pradesh.'),
    ).toBeInTheDocument();
  });

  it('offers the PIN code’s localities for the area, and still takes a typed street', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(box('pincode'), '531081');
    await waitFor(() => expect(box('city')).toHaveValue('Visakhapatnam'));

    await user.type(box('line2'), 'chan');
    const list = await screen.findByRole('listbox');
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Chandanada']);
    await user.click(within(list).getByRole('option', { name: 'Chandanada' }));
    expect(latest.line2).toBe('Chandanada');

    await user.clear(box('line2'));
    await user.type(box('line2'), 'Gandhi Road');
    expect(latest.line2).toBe('Gandhi Road');
  });

  it('leaves the state to the person when the PIN code spans two states', async () => {
    lookupPincode.mockResolvedValue({
      pincode: '396230',
      city: 'Dadra and Nagar Haveli',
      state: null,
      states: ['Dadra and Nagar Haveli and Daman and Diu', 'Gujarat'],
      areas: [],
    });
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box('pincode'), '396230');

    await waitFor(() => expect(box('city')).toHaveValue('Dadra and Nagar Haveli'));
    expect(latest.state).toBe('');
    expect(
      screen.getByText(/covers Dadra and Nagar Haveli and Daman and Diu and Gujarat/),
    ).toBeInTheDocument();
  });

  it('says so when the PIN code is unknown, and leaves what was typed alone', async () => {
    lookupPincode.mockRejectedValue(notFound());
    const user = userEvent.setup();
    render(<Harness start={{ ...EMPTY_ADDRESS, city: 'Vizag' }} />);

    await user.type(box('pincode'), '999999');

    expect(await screen.findByText(/not in India Post’s directory/)).toBeInTheDocument();
    expect(box('city')).toHaveValue('Vizag');
  });

  it('carries on without it when the directory cannot be reached', async () => {
    lookupPincode.mockRejectedValue(new Error('Network Error'));
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(box('pincode'), '531081');

    expect(await screen.findByText(/fill in the town and state yourself/)).toBeInTheDocument();
    await user.type(box('city'), 'Anakapalle');
    expect(latest.city).toBe('Anakapalle');
  });

  it('never looks up a PIN code that cannot exist, or one outside India', async () => {
    const user = userEvent.setup();
    render(<Harness start={{ ...EMPTY_ADDRESS, country: 'GB' }} />);
    await user.type(box('pincode'), 'SW1A 1AA');

    render(<Harness />);
    await user.type(document.querySelectorAll<HTMLInputElement>('#home-pincode')[1]!, '012345');

    expect(lookupPincode).not.toHaveBeenCalled();
  });
});
