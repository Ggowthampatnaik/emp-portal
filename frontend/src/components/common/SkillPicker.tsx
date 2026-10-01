/**
 * Multi-select over the skill vocabulary.
 *
 * Built here rather than inside a feature because three places need the same
 * control: the profile editor, the employee filters, and (later) the
 * complete-profile wizard. The vocabulary is fetched once per mount and
 * filtered client-side — it is a few dozen rows, so a request per keystroke
 * would cost more than it saves.
 */

import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import { useCallback } from 'react';

import { useApiResource } from '@/hooks/useApiResource';
import { skillsApi } from '@/services/api/services';
import type { Skill } from '@/types/domain';

interface Props {
  /** Currently selected skill ids. */
  value: number[];
  /** The chosen rows are passed alongside the ids so callers can show names. */
  onChange: (ids: number[], skills: Skill[]) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  size?: 'small' | 'medium';
  disabled?: boolean;
  /** Rendered inline in a filter bar rather than stacked in a form. */
  dense?: boolean;
}

export default function SkillPicker({
  value,
  onChange,
  label = 'Skills',
  placeholder,
  helperText,
  size = 'small',
  disabled,
  dense,
}: Props) {
  const { data, loading } = useApiResource(
    useCallback(() => skillsApi.list({ page_size: 200 }), []),
    [],
  );

  const options = data?.results ?? [];
  const selected = options.filter((skill) => value.includes(skill.id));

  return (
    <Autocomplete
      multiple
      disableCloseOnSelect
      size={size}
      disabled={disabled || loading}
      options={options}
      value={selected}
      groupBy={(skill) => skill.category_label}
      getOptionLabel={(skill: Skill) => skill.name}
      isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
      onChange={(_, chosen) =>
        onChange(
          chosen.map((skill) => skill.id),
          chosen,
        )
      }
      renderTags={(chosen, getTagProps) =>
        chosen.map((skill, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return <Chip {...tagProps} key={key} size="small" label={skill.name} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={selected.length === 0 ? (placeholder ?? 'Start typing…') : undefined}
          helperText={helperText}
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
      // Dense mode sits in a filter row beside a fixed-width Department
      // select. Growing made it roughly twice that width for no reason; the
      // search box is the field that earns the leftover space.
      sx={dense ? { width: 220, flexGrow: 0, flexShrink: 0 } : undefined}
    />
  );
}
