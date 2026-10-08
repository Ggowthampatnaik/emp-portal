/**
 * Phone numbers, checked per country as the person types.
 *
 * The server applies the same rules (backend/common/phone.py, Google's
 * libphonenumber) and stores E.164 - "+919876543210". This is the JavaScript
 * port of the same library, with the full metadata so a landline can be told
 * from a mobile exactly as the server tells them apart. Messages match the
 * server's word for word.
 */

import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';

export const DEFAULT_COUNTRY: CountryCode = 'IN';

export interface CountryOption {
  code: CountryCode;
  name: string;
  dial: string;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** India first - most people here are - then every other country A to Z. */
export const COUNTRIES: CountryOption[] = (() => {
  const all = getCountries().map((code) => ({
    code,
    name: regionNames.of(code) ?? code,
    dial: `+${getCountryCallingCode(code)}`,
  }));
  const india = all.filter((c) => c.code === DEFAULT_COUNTRY);
  const rest = all
    .filter((c) => c.code !== DEFAULT_COUNTRY)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...india, ...rest];
})();

export const countryOption = (code: CountryCode): CountryOption =>
  COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0]!;

/** Splits a stored number ("+919876543210", or older "+91 98765 43210") back
 *  into the picker's country and the digits after the country code. */
export function splitStored(value: string): { country: CountryCode; national: string } {
  const parsed = value ? parsePhoneNumberFromString(value, DEFAULT_COUNTRY) : undefined;
  if (!parsed) return { country: DEFAULT_COUNTRY, national: value.replace(/^\+\d+\s*/, '') };
  return {
    country: parsed.country ?? DEFAULT_COUNTRY,
    national: String(parsed.nationalNumber),
  };
}

/** What gets saved: E.164 when the number parses, otherwise the raw attempt
 *  with its country code so the server can say what is wrong with it. */
export function toStored(country: CountryCode, national: string): string {
  const digits = national.replace(/[^\d]/g, '');
  if (!digits) return '';
  const parsed = parsePhoneNumberFromString(digits, country);
  return parsed?.number ?? `+${getCountryCallingCode(country)}${digits}`;
}

/** Why the number would be refused, or null when it is fine. Mirrors the server. */
export function phoneProblem(value: string, mobile: boolean): string | null {
  if (!value) return null;
  const parsed = parsePhoneNumberFromString(value, DEFAULT_COUNTRY);
  if (!parsed) return 'Enter a valid phone number.';

  const valid = parsed.isValid();
  const type = parsed.getType();
  const isMobile = type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE';

  if (parsed.countryCallingCode === '91' && (!valid || (mobile && !isMobile))) {
    return mobile
      ? 'Enter a valid 10-digit Indian mobile number, starting with 6, 7, 8 or 9.'
      : 'Enter a valid Indian phone number.';
  }
  if (!valid) {
    return `This is not a valid number for +${parsed.countryCallingCode}. Check the country code and the number.`;
  }
  if (mobile && !isMobile) return 'Enter a mobile number, not a landline.';
  return null;
}

/** "+919876543210" -> "+91 98765 43210", for reading. Anything unparseable as stored. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = parsePhoneNumberFromString(value, DEFAULT_COUNTRY);
  return parsed?.isValid() ? parsed.formatInternational() : value;
}
