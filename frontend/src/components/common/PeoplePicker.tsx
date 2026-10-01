/**
 * Multi-select over colleagues, backed by `/employees/search/`.
 *
 * Unlike the skill vocabulary this cannot be fetched once and filtered in the
 * browser — a company is too big for that — so it queries as you type, with a
 * debounce, and waits for two characters before it bothers the server.
 *
 * Below that threshold the dropdown stays shut rather than opening to announce
 * that it has nothing: a box that appears only to say "type more" is noise over
 * the form behind it.
 *
 * It returns **portal account ids**, because the things that address people
 * (leave CC today, others later) are addressed to the account, not to the
 * employment record.
 */

import Autocomplete from '@mui/material/Autocomplete';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';

import { employeesApi } from '@/services/api/services';
import type { PersonSearchResult } from '@/types/domain';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

interface Props {
  /** The people currently chosen. Held as whole rows so chips keep their names. */
  value: PersonSearchResult[];
  onChange: (people: PersonSearchResult[]) => void;
  label?: string;
  helperText?: string;
  /** Refuses to add more than this many. */
  max?: number;
  disabled?: boolean;
}

export default function PeoplePicker({
  value,
  onChange,
  label = 'People',
  helperText,
  max,
  disabled,
}: Props) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<PersonSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = term.trim();
    if (query.length < MIN_CHARS) {
      setOptions([]);
      return;
    }

    let live = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      employeesApi
        .search(query)
        .then((results) => {
          if (live) setOptions(results);
        })
        .catch(() => {
          if (live) setOptions([]);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  const full = max !== undefined && value.length >= max;

  /** Never offer someone who is already in the list. */
  const offered = useMemo(
    () =>
      options.filter((person) => !value.some((chosen) => chosen.user_id === person.user_id)),
    [options, value],
  );

  return (
    <Autocomplete
      multiple
      disabled={disabled}
      size="small"
      options={offered}
      value={value}
      loading={loading}
      filterOptions={(all) => all} // the server has already filtered
      getOptionLabel={(person: PersonSearchResult) => person.full_name}
      isOptionEqualToValue={(option, chosen) => option.user_id === chosen.user_id}
      onInputChange={(_, next) => setTerm(next)}
      onChange={(_, chosen) => onChange(max ? chosen.slice(0, max) : chosen)}
      // Closed until there is something to say. The dropdown used to open on
      // the first keystroke just to float "Type at least 2 letters" over the
      // form - a box that appears only to tell you it has nothing. It opens
      // once the search is live, so "Nobody matches" below is only ever
      // reachable with a real term behind it.
      open={open && (loading || offered.length > 0 || term.trim().length >= MIN_CHARS)}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      noOptionsText="Nobody matches"
      renderOption={(props, person) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <Box component="li" key={key} {...rest}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
              <Avatar
                src={person.photo_url ?? undefined}
                alt={person.full_name}
                sx={{ width: 28, height: 28, fontSize: 12, bgcolor: 'primary.light' }}
              >
                {person.full_name[0]?.toUpperCase()}
              </Avatar>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {person.full_name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap display="block">
                  {person.employee_code}
                  {person.designation_name ? ` · ${person.designation_name}` : ''}
                </Typography>
              </Box>
            </Stack>
          </Box>
        );
      }}
      renderTags={(chosen, getTagProps) =>
        chosen.map((person, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return (
            <Chip
              {...tagProps}
              key={key}
              size="small"
              avatar={
                <Avatar src={person.photo_url ?? undefined} alt={person.full_name}>
                  {person.full_name[0]?.toUpperCase()}
                </Avatar>
              }
              label={person.full_name}
            />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={full ? undefined : 'Start typing a name'}
          helperText={full ? `That is the maximum of ${max} people.` : helperText}
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading && <CircularProgress size={16} />}
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
