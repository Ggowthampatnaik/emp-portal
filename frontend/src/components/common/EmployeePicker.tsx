/**
 * Pick one employee by typing.
 *
 * The forms that need this used to render a `<Select>` of the first hundred
 * active employees: no typing, and silently the wrong answer past a hundred
 * people. This asks the server instead, so it narrows on what is actually
 * stored — name, employee code, email — and cannot run out of company.
 *
 * It opens with a first page already loaded, so clicking it shows people
 * straight away and typing narrows them. That is the opposite of `PeoplePicker`,
 * which searches the whole company for a CC list and has nothing sensible to
 * show before a term exists.
 *
 * Returns the **employee id** — the employment record — because the things it
 * fills in (a salary structure, a project membership) hang off employment, not
 * off the portal account.
 */

import Autocomplete from '@mui/material/Autocomplete';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

import { employeesApi } from '@/services/api/services';
import type { EmployeeListItem } from '@/types/domain';

const DEBOUNCE_MS = 300;
const PAGE = 20;

interface Props {
  /** The chosen employee id, or null. */
  value: number | null;
  onChange: (employeeId: number | null, employee: EmployeeListItem | null) => void;
  label?: string;
  helperText?: string;
  error?: boolean;
  required?: boolean;
  disabled?: boolean;
  size?: 'small' | 'medium';
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default function EmployeePicker({
  value,
  onChange,
  label = 'Employee',
  helperText,
  error,
  required,
  disabled,
  size = 'medium',
}: Props) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<EmployeeListItem[]>([]);
  const [chosen, setChosen] = useState<EmployeeListItem | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        setLoading(true);
        try {
          const page = await employeesApi.list({
            page_size: PAGE,
            employment_status: 'active',
            search: term.trim() || undefined,
            ordering: 'employee_code',
          });
          if (!cancelled) setOptions(page.results);
        } catch {
          // A failed lookup leaves the list as it was rather than emptying it
          // under the cursor; the field below still says what went in.
          if (!cancelled) setOptions([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      },
      term ? DEBOUNCE_MS : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  // A value set from outside (an edit, a reset) has to find its own label.
  useEffect(() => {
    if (value === null) {
      setChosen(null);
      return;
    }
    if (chosen?.id === value) return;
    const known = options.find((row) => row.id === value);
    if (known) setChosen(known);
  }, [value, options, chosen]);

  return (
    <Autocomplete
      options={options}
      value={chosen}
      loading={loading}
      disabled={disabled}
      size={size}
      // The server has already narrowed; filtering again would hide rows that
      // matched on a field the label does not show, like an email.
      filterOptions={(all) => all}
      getOptionLabel={(person: EmployeeListItem) =>
        `${person.full_name} (${person.employee_code})`
      }
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      onInputChange={(_, next, reason) => {
        if (reason === 'input') setTerm(next);
      }}
      onChange={(_, person) => {
        setChosen(person);
        onChange(person?.id ?? null, person);
      }}
      noOptionsText={loading ? 'Searching...' : 'Nobody matches'}
      renderOption={(props, person) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...rest}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
              <Avatar
                src={person.photo_url ?? undefined}
                alt=""
                sx={{ width: 32, height: 32, fontSize: 13 }}
              >
                {initials(person.full_name)}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {person.full_name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {person.employee_code}
                  {person.designation_name ? ` · ${person.designation_name}` : ''}
                  {person.department_name ? ` · ${person.department_name}` : ''}
                </Typography>
              </Box>
            </Stack>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required}
          error={error}
          helperText={helperText}
          placeholder="Type a name, code or email"
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
