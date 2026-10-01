/**
 * The skills section of a profile.
 *
 * Skills come from a controlled vocabulary (decision D10) so the staffing
 * filter has something stable to match on — free text would scatter "React",
 * "ReactJS" and "react" across three unmatchable values.
 *
 * The whole set is saved in one PUT, which makes add, edit and remove the same
 * operation and avoids a half-saved profile.
 */

import PsychologyIcon from '@mui/icons-material/Psychology';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { ErrorAlert } from '@/components/common/Feedback';
import SectionCard from '@/components/common/SectionCard';
import ShowMoreButton from '@/components/common/ShowMoreButton';
import ViewAllDialog from '@/components/common/ViewAllDialog';
import SkillPicker from '@/components/common/SkillPicker';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { PROFILE_CHIPS, useShowMore } from '@/hooks/useShowMore';
import { employeesApi } from '@/services/api/services';
import {
  PROFICIENCIES,
  type EmployeeSkill,
  type Proficiency,
  type Skill,
} from '@/types/domain';

const CHIP_COLOR: Record<Proficiency, 'default' | 'info' | 'primary' | 'success'> = {
  beginner: 'default',
  intermediate: 'info',
  advanced: 'primary',
  expert: 'success',
};

/** Working copy of one row while the editor is open. */
type Draft = {
  skill: number;
  name: string;
  proficiency: Proficiency;
  years: string;
};

function toDraft(row: EmployeeSkill): Draft {
  return {
    skill: row.skill,
    name: row.skill_name,
    proficiency: row.proficiency,
    years: row.years_of_experience ?? '',
  };
}

/** One skill. Same chip in the card and in the dialog behind it. */
function SkillChip({ row }: { row: EmployeeSkill }) {
  const level = PROFICIENCIES.find((option) => option.value === row.proficiency)?.label ?? '';
  return (
    <Tooltip
      title={row.years_of_experience ? `${level} · ${row.years_of_experience} years` : level}
    >
      <Chip
        label={row.skill_name}
        color={CHIP_COLOR[row.proficiency]}
        variant={row.proficiency === 'beginner' ? 'outlined' : 'filled'}
        size="small"
      />
    </Tooltip>
  );
}

export default function SkillsCard({
  employeeId,
  canEdit,
}: {
  employeeId: number;
  canEdit: boolean;
}) {
  const dispatch = useAppDispatch();
  const { data, loading, error, reload, setData } = useApiResource(
    useCallback(() => employeesApi.employeeSkills(employeeId), [employeeId]),
    [employeeId],
  );
  const save = useApiAction(employeesApi.saveEmployeeSkills);

  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    setDrafts((data ?? []).map(toDraft));
  }, [data]);

  /** The picker owns which skills are selected; these rows carry the detail. */
  const onSelectionChange = (ids: number[], chosen: Skill[]) => {
    setDrafts((prev) => {
      const kept = prev.filter((row) => ids.includes(row.skill));
      const added = chosen
        .filter((skill) => !prev.some((row) => row.skill === skill.id))
        .map<Draft>((skill) => ({
          skill: skill.id,
          name: skill.name,
          proficiency: 'intermediate',
          years: '',
        }));
      return [...kept, ...added];
    });
  };

  const setRow = (skill: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((row) => (row.skill === skill ? { ...row, ...patch } : row)));

  const handleSave = async () => {
    const saved = await save.run(
      employeeId,
      drafts.map((row) => ({
        skill: row.skill,
        proficiency: row.proficiency,
        years_of_experience: row.years === '' ? null : row.years,
      })),
    );
    if (saved) {
      setData(saved);
      setEditing(false);
      dispatch(showToast('Skills updated.', 'success'));
    }
  };

  const rows = data ?? [];
  // Chips wrap, so more of them fit in a line than list rows would: four is
  // about the height of the single Experience row beside it, which is what
  // keeps that pair level.
  const more = useShowMore(rows, PROFILE_CHIPS);

  return (
    <SectionCard
      title="Skills"
      icon={<PsychologyIcon color="primary" />}
      subtitle="What you can be staffed on. Optional."
      count={editing ? undefined : rows.length}
      // Only while reading: the editor needs every skill on screen at once.
      footer={
        editing ? undefined : (
          <ShowMoreButton hidden={more.hidden} onClick={more.show} noun="skills" />
        )
      }
      action={
        canEdit && !editing ? (
          <Button
            size="small"
            startIcon={<EditIcon />}
            onClick={() => {
              save.clearError();
              setEditing(true);
            }}
          >
            {rows.length === 0 ? 'Add' : 'Edit'}
          </Button>
        ) : undefined
      }
    >
      {loading && <LinearProgress sx={{ mb: 2 }} />}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {save.error && <ErrorAlert error={save.error} />}

      {editing ? (
        <Stack spacing={2}>
          <SkillPicker
            value={drafts.map((row) => row.skill)}
            onChange={onSelectionChange}
            helperText="Pick from the company skill list. HR maintains the list itself."
          />

          {drafts.length > 0 && (
            <Stack spacing={1.5} divider={<Divider flexItem />}>
              {drafts.map((row) => (
                <Stack
                  key={row.skill}
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                >
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    sx={{ flexGrow: 1, minWidth: 0 }}
                  >
                    {row.name}
                  </Typography>
                  <TextField
                    select
                    size="small"
                    label="Level"
                    value={row.proficiency}
                    onChange={(event) =>
                      setRow(row.skill, { proficiency: event.target.value as Proficiency })
                    }
                    sx={{ minWidth: 150 }}
                  >
                    {PROFICIENCIES.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    size="small"
                    type="number"
                    label="Years"
                    value={row.years}
                    onChange={(event) => setRow(row.skill, { years: event.target.value })}
                    slotProps={{ htmlInput: { min: 0, max: 60, step: 0.5 } }}
                    sx={{ width: 110 }}
                  />
                </Stack>
              ))}
            </Stack>
          )}

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button
              onClick={() => {
                setDrafts(rows.map(toDraft));
                setEditing(false);
                save.clearError();
              }}
              disabled={save.busy}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={save.busy}
            >
              {save.busy ? 'Saving...' : 'Save'}
            </Button>
          </Stack>
        </Stack>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No skills recorded
          {canEdit ? ' yet — add them so you show up in staffing searches.' : '.'}
        </Typography>
      ) : (
        <>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {more.visible.map((row) => (
              <SkillChip key={row.id} row={row} />
            ))}
          </Box>

          <ViewAllDialog
            open={more.open}
            onClose={more.close}
            title={`Skills · ${rows.length}`}
          >
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {rows.map((row) => (
                <SkillChip key={row.id} row={row} />
              ))}
            </Box>
          </ViewAllDialog>
        </>
      )}
    </SectionCard>
  );
}
