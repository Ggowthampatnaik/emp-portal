/**
 * One postal address, field by field: country, PIN code, house, street,
 * landmark, town/city and state - the layout Indian address forms use.
 *
 * India gets a 6-digit PIN code and a state list; any other country gets a
 * free postal code and region. A field's problem shows once the person has
 * left it, not while they are still typing.
 *
 * Typing an Indian PIN code fills in the town and state from India Post's
 * directory (via the API, common/pincode.py), and offers the PIN code's
 * localities as suggestions for "Area, Street, Sector, Village". The lookup
 * only ever helps: if it fails, everything can still be typed by hand.
 */

import Autocomplete from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { isAxiosError } from 'axios';
import { useRef, useState } from 'react';

import { addressApi } from '@/services/api/services';
import {
  addressProblems,
  INDIA,
  INDIAN_STATES,
  type AddressDetail,
  type AddressField,
} from '@/utils/address';
import { COUNTRIES, countryOption } from '@/utils/phone';

interface Props {
  value: AddressDetail;
  onChange: (value: AddressDetail) => void;
  /** Prefixes field ids, so two addresses on one page stay distinct. */
  idPrefix: string;
  disabled?: boolean;
  /** Errors from the server, by field - they win over the local check. */
  serverErrors?: Partial<Record<AddressField, string>>;
}

type Lookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'found'; filled: string; areas: string[]; borderStates: string[] }
  | { status: 'missing' }
  | { status: 'unavailable' };

const VALID_PIN = /^[1-9]\d{5}$/;

export default function AddressFields({
  value,
  onChange,
  idPrefix,
  disabled,
  serverErrors = {},
}: Props) {
  const [touched, setTouched] = useState<Partial<Record<AddressField, boolean>>>({});
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' });
  // The answer arrives after the person may have typed on: merge it into the
  // address as it is *then*, and drop answers for a PIN code since changed.
  const latest = useRef(value);
  latest.current = value;
  const askedFor = useRef('');

  const problems = addressProblems(value);
  const india = value.country === INDIA;

  const set = (field: AddressField, next: string) => onChange({ ...value, [field]: next });
  const errorFor = (field: AddressField) =>
    serverErrors[field] ?? (touched[field] ? problems[field] : undefined);

  const field = (
    name: AddressField,
    label: string,
    extra: { placeholder?: string; helper?: string } = {},
  ) => ({
    id: `${idPrefix}-${name}`,
    label,
    value: value[name],
    onChange: (event: { target: { value: string } }) => set(name, event.target.value),
    onBlur: () => setTouched((current) => ({ ...current, [name]: true })),
    error: Boolean(errorFor(name)),
    helperText: errorFor(name) ?? extra.helper ?? ' ',
    placeholder: extra.placeholder,
    disabled,
    fullWidth: true,
  });

  const lookUp = async (pin: string) => {
    askedFor.current = pin;
    setLookup({ status: 'loading' });
    try {
      const found = await addressApi.lookupPincode(pin);
      if (askedFor.current !== pin) return;
      const next = { ...latest.current };
      // Town and state follow from the PIN code, so they are replaced - a
      // town typed for the old PIN would be wrong for the new one. A border
      // PIN (two states) leaves the state to the person.
      if (found.city) next.city = found.city;
      next.state = found.state ?? (found.states.includes(next.state) ? next.state : '');
      onChange(next);
      setLookup({
        status: 'found',
        filled: [found.city, found.state].filter(Boolean).join(', '),
        areas: found.areas,
        borderStates: found.state ? [] : found.states,
      });
    } catch (error) {
      if (askedFor.current !== pin) return;
      const missing = isAxiosError(error) && error.response?.status === 404;
      setLookup({ status: missing ? 'missing' : 'unavailable' });
    }
  };

  const pinHelper = (): { text: string; error?: boolean } | undefined => {
    if (!india) return undefined;
    switch (lookup.status) {
      case 'loading':
        return { text: 'Looking up the PIN code...' };
      case 'found':
        return lookup.filled
          ? { text: `Filled in from the PIN code: ${lookup.filled}.` }
          : undefined;
      case 'missing':
        return {
          text: 'This PIN code is not in India Post’s directory. Check it, or fill in the town and state yourself.',
          error: true,
        };
      case 'unavailable':
        return {
          text: 'Could not look up the PIN code just now - fill in the town and state yourself.',
        };
      default:
        return undefined;
    }
  };
  const pinNote = pinHelper();
  const areas = lookup.status === 'found' ? lookup.areas : [];
  const borderStates = lookup.status === 'found' ? lookup.borderStates : [];

  return (
    <Stack spacing={1}>
      <Autocomplete
        options={COUNTRIES}
        value={countryOption(value.country as Parameters<typeof countryOption>[0])}
        disableClearable
        autoHighlight
        disabled={disabled}
        // A change of country clears what only made sense in the old one.
        onChange={(_, next) => {
          askedFor.current = '';
          setLookup({ status: 'idle' });
          onChange({ ...value, country: next.code, pincode: '', state: '' });
        }}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(option, selected) => option.code === selected.code}
        renderOption={({ key: _labelKey, ...props }, option) => (
          <li key={option.code} {...props}>
            {option.name}
          </li>
        )}
        // The id goes on the Autocomplete: it hands its own to the input.
        id={`${idPrefix}-country`}
        renderInput={(params) => (
          <TextField {...params} label="Country/Region" required helperText=" " />
        )}
      />

      <TextField
        {...field('pincode', india ? 'Pincode' : 'Postal code', {
          placeholder: india ? '6 digits [0-9] PIN code' : undefined,
        })}
        required={india}
        error={Boolean(errorFor('pincode')) || Boolean(pinNote?.error)}
        helperText={errorFor('pincode') ?? pinNote?.text ?? ' '}
        onChange={(event) => {
          if (!india) {
            set('pincode', event.target.value);
            return;
          }
          const pin = event.target.value.replace(/\D/g, '').slice(0, 6);
          set('pincode', pin);
          // Six good digits is the moment to ask - not before, not again.
          if (VALID_PIN.test(pin) && pin !== askedFor.current) void lookUp(pin);
          else if (!VALID_PIN.test(pin)) {
            askedFor.current = '';
            setLookup({ status: 'idle' });
          }
        }}
        slotProps={{
          htmlInput: { inputMode: india ? 'numeric' : 'text', maxLength: india ? 6 : 10 },
          input: {
            endAdornment:
              lookup.status === 'loading' ? (
                <InputAdornment position="end">
                  <CircularProgress size={18} aria-label="Looking up the PIN code" />
                </InputAdornment>
              ) : undefined,
          },
        }}
      />
      <TextField
        {...field('line1', 'Flat, House no., Building, Company, Apartment')}
        required
        slotProps={{ htmlInput: { maxLength: 120 } }}
      />
      {/* The PIN code's post offices are its localities - offered while
          typing, never forced: a street name is just as welcome. */}
      <Autocomplete
        freeSolo
        options={areas}
        inputValue={value.line2}
        onInputChange={(_, next) => set('line2', next)}
        disabled={disabled}
        id={`${idPrefix}-line2`}
        renderInput={(params) => {
          const props = field('line2', 'Area, Street, Sector, Village', {
            helper: areas.length ? 'Pick your locality, or type the street.' : undefined,
          });
          return (
            <TextField
              {...params}
              label={props.label}
              onBlur={props.onBlur}
              error={props.error}
              helperText={props.helperText}
              required
              slotProps={{ htmlInput: { ...params.inputProps, maxLength: 120 } }}
            />
          );
        }}
      />
      <TextField
        {...field('landmark', 'Landmark', { placeholder: 'E.g. near Apollo Hospital' })}
        slotProps={{ htmlInput: { maxLength: 120 } }}
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          {...field('city', 'Town/City')}
          required
          slotProps={{ htmlInput: { maxLength: 60 } }}
        />
        {india ? (
          <TextField
            {...field('state', 'State', {
              helper:
                borderStates.length > 1
                  ? `This PIN code covers ${borderStates.join(' and ')} - choose yours.`
                  : undefined,
            })}
            select
            required
          >
            {INDIAN_STATES.map((state) => (
              <MenuItem key={state} value={state}>
                {state}
              </MenuItem>
            ))}
          </TextField>
        ) : (
          <TextField
            {...field('state', 'State/Province/Region')}
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
        )}
      </Stack>
    </Stack>
  );
}
