/**
 * A phone number with its country code: a searchable country picker (India
 * first) beside the number. The value handed back is what the server stores -
 * E.164, "+919876543210" - so the parent never deals in country codes.
 *
 * Errors appear once the person leaves the field, not while they are still
 * typing the third digit.
 */

import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';

import CountryFlag from '@/components/common/CountryFlag';
import {
  COUNTRIES,
  countryOption,
  phoneProblem,
  splitStored,
  toStored,
  type CountryOption,
} from '@/utils/phone';

const filterCountries = createFilterOptions<CountryOption>({
  stringify: (option) => `${option.name} ${option.code} ${option.dial} ${option.dial.slice(1)}`,
});

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** True for the employee's own number: landlines are refused. */
  mobile?: boolean;
  required?: boolean;
  /** An error from the server, which wins over the local check. */
  serverError?: string;
  helperText?: string;
  size?: 'small' | 'medium';
}

export default function PhoneNumberInput({
  label,
  value,
  onChange,
  mobile = true,
  required,
  serverError,
  helperText = 'Choose the country, then type the number without the country code.',
  size = 'medium',
}: Props) {
  const [initial] = useState(() => splitStored(value));
  const [country, setCountry] = useState<CountryOption>(() => countryOption(initial.country));
  const [national, setNational] = useState(initial.national);
  // A number already on file is checked straight away: one saved before
  // these rules existed should say what is wrong with it, not wait for a blur.
  const [touched, setTouched] = useState(() => Boolean(value));

  const problem = touched ? phoneProblem(value, mobile) : null;
  const error = serverError ?? problem;

  const emit = (nextCountry: CountryOption, nextNational: string) =>
    onChange(toStored(nextCountry.code, nextNational));

  return (
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <Autocomplete
        options={COUNTRIES}
        value={country}
        disableClearable
        autoHighlight
        size={size}
        onChange={(_, next) => {
          setCountry(next);
          emit(next, national);
        }}
        // The box shows just "+91" - the name is in the list, and the number
        // needs the width. Searching still matches "india", "IN" or "91".
        getOptionLabel={(option) => option.dial}
        filterOptions={filterCountries}
        isOptionEqualToValue={(option, selected) => option.code === selected.code}
        // MUI keys rows by the label, and the label is the dial code - which
        // +1, +44 and +358 share across countries. Duplicate keys left stale
        // rows in the list, so each row is keyed by its own country.
        renderOption={({ key: _labelKey, ...props }, option) => (
          <Box component="li" key={option.code} {...props} sx={{ gap: 1.25 }}>
            <CountryFlag code={option.code} />
            <Typography component="span" sx={{ minWidth: 48, fontWeight: 600 }}>
              {option.dial}
            </Typography>
            {option.name}
          </Box>
        )}
        // The chosen country's flag sits beside its code in the box.
        renderInput={(params) => (
          <TextField
            {...params}
            label="Country code"
            error={Boolean(error)}
            helperText=" "
            slotProps={{
              input: {
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position="start" sx={{ ml: 0.5, mr: 0 }}>
                    <CountryFlag code={country.code} />
                  </InputAdornment>
                ),
              },
            }}
          />
        )}
        // Wider than the box, and anchored to its left edge rather than centred.
        slotProps={{ popper: { placement: 'bottom-start', sx: { minWidth: 340 } } }}
        sx={{ width: 160, flexShrink: 0 }}
      />
      <TextField
        label={label}
        value={national}
        onChange={(event) => {
          // Digits, spaces and dashes only - the country code has its own box.
          const typed = event.target.value.replace(/[^\d\s-]/g, '');
          setNational(typed);
          emit(country, typed);
        }}
        onBlur={() => setTouched(true)}
        required={required}
        size={size}
        fullWidth
        error={Boolean(error)}
        helperText={error ?? helperText}
        slotProps={{ htmlInput: { inputMode: 'tel', autoComplete: 'tel-national' } }}
      />
    </Stack>
  );
}
