/**
 * Addresses entered field by field, the way Indian address forms ask for them.
 * The server applies the same rules (backend/common/address.py) and builds the
 * one-line address of record from the parts. Messages match it word for word.
 */

export interface AddressDetail {
  /** ISO country code - "IN". */
  country: string;
  pincode: string;
  /** Flat, house no., building, company, apartment. */
  line1: string;
  /** Area, street, sector, village. */
  line2: string;
  landmark: string;
  city: string;
  state: string;
}

export type AddressField = keyof AddressDetail;

export const INDIA = 'IN';

export const EMPTY_ADDRESS: AddressDetail = {
  country: INDIA,
  pincode: '',
  line1: '',
  line2: '',
  landmark: '',
  city: '',
  state: '',
};

/** The 28 states and 8 union territories, as India Post spells them. */
export const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;

const INDIAN_PIN = /^[1-9]\d{5}$/;
const POSTAL_CODE = /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/;
const CITY = /^\p{L}+(?:[ .'-]+\p{L}+)*\.?$/u;

/** A stored address (possibly empty, possibly a draft) as a full form value. */
export const toAddress = (stored?: Partial<AddressDetail> | null): AddressDetail => ({
  ...EMPTY_ADDRESS,
  ...Object.fromEntries(Object.entries(stored ?? {}).filter(([, value]) => value)),
});

/** True once anything beyond the default country has been typed. */
export const hasAnyAddress = (address: AddressDetail): boolean =>
  (Object.keys(EMPTY_ADDRESS) as AddressField[]).some(
    (field) => field !== 'country' && address[field].trim() !== '',
  );

/** What is wrong with each field, by field. Empty when the address is fine. */
export function addressProblems(address: AddressDetail): Partial<Record<AddressField, string>> {
  const problems: Partial<Record<AddressField, string>> = {};
  const india = address.country === INDIA;
  const pincode = address.pincode.trim();

  if (india && !INDIAN_PIN.test(pincode)) {
    problems.pincode = 'Enter a 6-digit PIN code (it cannot start with 0).';
  } else if (!india && pincode && !POSTAL_CODE.test(pincode)) {
    problems.pincode = 'Enter a valid postal code.';
  }
  if (!address.line1.trim()) problems.line1 = 'Enter the flat, house number or building.';
  if (!address.line2.trim()) problems.line2 = 'Enter the area, street, sector or village.';

  const city = address.city.trim().replace(/\s+/g, ' ');
  if (!city) problems.city = 'Enter the town or city.';
  else if (!CITY.test(city)) problems.city = 'Enter the town or city name in letters.';

  if (india && !(INDIAN_STATES as readonly string[]).includes(address.state)) {
    problems.state = 'Choose a state from the list.';
  }
  return problems;
}

export const isAddressValid = (address: AddressDetail): boolean =>
  Object.keys(addressProblems(address)).length === 0;
