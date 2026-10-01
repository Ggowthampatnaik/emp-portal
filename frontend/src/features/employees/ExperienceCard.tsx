/**
 * Previous employment on a profile.
 *
 * Optional, and the employee's own to maintain. Saved as one PUT of the whole
 * set — the same shape SkillsCard uses — which makes add, edit and remove a
 * single operation and rules out a half-saved history.
 *
 * A blank end date means "until I joined here", which is how people actually
 * describe their last job, so it is stored that way rather than as a guessed
 * date.
 */

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import SectionCard from '@/components/common/SectionCard';
import ShowMoreButton from '@/components/common/ShowMoreButton';
import ViewAllDialog from '@/components/common/ViewAllDialog';
import { ErrorAlert } from '@/components/common/Feedback';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { useShowMore } from '@/hooks/useShowMore';
import { formatDate } from '@/utils/date';
import { employeesApi } from '@/services/api/services';
import type { ExperienceDetail } from '@/types/domain';

/** Working copy of one row while the editor is open. */
type Draft = {
  company_name: string;
  job_title: string;
  from_date: string;
  to_date: string;
  description: string;
};

const EMPTY: Draft = {
  company_name: '',
  job_title: '',
  from_date: '',
  to_date: '',
  description: '',
};

function toDraft(row: ExperienceDetail): Draft {
  return {
    company_name: row.company_name,
    job_title: row.job_title,
    from_date: row.from_date,
    to_date: row.to_date ?? '',
    description: row.description ?? '',
  };
}

/** One role. Rendered identically in the card and in the dialog behind it. */
function ExperienceRow({ row }: { row: ExperienceDetail }) {
  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Typography variant="subtitle2">{row.job_title}</Typography>
        <Typography variant="body2" color="text.secondary">
          at {row.company_name}
        </Typography>
        {row.is_current && <Chip size="small" label="Most recent" color="info" />}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {period(row)}
      </Typography>
      {row.description && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {row.description}
        </Typography>
      )}
    </Box>
  );
}

function period(row: ExperienceDetail): string {
  // Through the shared formatter, so this reads "1 Jun 2019 — 14 Feb 2021"
  // like every other date on the profile rather than raw ISO beside them.
  return `${formatDate(row.from_date)} — ${row.to_date ? formatDate(row.to_date) : 'present'}`;
}

export default function ExperienceCard({
  employeeId,
  canEdit,
}: {
  employeeId: number;
  canEdit: boolean;
}) {
  const dispatch = useAppDispatch();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const { data, loading, error, reload } = useApiResource(
    useCallback(() => employeesApi.experience(employeeId), [employeeId]),
    [employeeId],
  );

  useEffect(() => {
    if (data) setDrafts(data.map(toDraft));
  }, [data]);

  const save = useApiAction((rows: Draft[]) =>
    employeesApi.saveExperience(
      employeeId,
      rows.map((row) => ({
        company_name: row.company_name.trim(),
        job_title: row.job_title.trim(),
        from_date: row.from_date,
        // Blank means the job ran until they joined here; the API wants null,
        // not an empty string it would then try to parse as a date.
        to_date: row.to_date || null,
        description: row.description.trim(),
      })),
    ),
  );

  const rows = data ?? [];
  const more = useShowMore(rows);

  const update = (index: number, patch: Partial<Draft>) =>
    setDrafts((current) =>
      current.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );

  const handleSave = async () => {
    const complete = drafts.filter(
      (row) => row.company_name.trim() && row.job_title.trim() && row.from_date,
    );
    const saved = await save.run(complete);
    if (saved === undefined) return;
    dispatch(showToast('Experience updated.', 'success'));
    setEditing(false);
    reload();
  };

  return (
    <SectionCard
      title="Experience"
      icon={<WorkHistoryIcon color="primary" />}
      subtitle="Where you worked before joining. Optional."
      count={editing ? undefined : rows.length}
      // Only while reading: the editor needs every row on screen at once.
      footer={
        editing ? undefined : (
          <ShowMoreButton hidden={more.hidden} onClick={more.show} noun="roles" />
        )
      }
      action={
        canEdit && !editing ? (
          <Button size="small" startIcon={<EditIcon />} onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : undefined
      }
    >
      {loading && <LinearProgress />}
      {error && <ErrorAlert error={error} onRetry={reload} />}
      {save.error && <ErrorAlert error={save.error} />}

      {!editing && !loading && !error && rows.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {canEdit ? 'Nothing recorded yet.' : 'No previous employment recorded.'}
        </Typography>
      )}

      {!editing && (
        <>
          <Stack spacing={1.5}>
            {more.visible.map((row) => (
              <ExperienceRow key={row.id} row={row} />
            ))}
          </Stack>

          <ViewAllDialog
            open={more.open}
            onClose={more.close}
            title={`Experience · ${rows.length} role${rows.length === 1 ? '' : 's'}`}
          >
            <Stack spacing={1.5}>
              {rows.map((row) => (
                <ExperienceRow key={row.id} row={row} />
              ))}
            </Stack>
          </ViewAllDialog>
        </>
      )}

      {editing && (
        <Stack spacing={2}>
          {drafts.map((row, index) => (
            <Box
              key={index}
              sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}
            >
              <Stack spacing={1.5}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField
                    label="Job title"
                    size="small"
                    value={row.job_title}
                    onChange={(event) => update(index, { job_title: event.target.value })}
                    disabled={save.busy}
                    fullWidth
                  />
                  <TextField
                    label="Company"
                    size="small"
                    value={row.company_name}
                    onChange={(event) => update(index, { company_name: event.target.value })}
                    disabled={save.busy}
                    fullWidth
                  />
                </Stack>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  alignItems="center"
                >
                  <TextField
                    label="From"
                    type="date"
                    size="small"
                    value={row.from_date}
                    onChange={(event) => update(index, { from_date: event.target.value })}
                    slotProps={{ inputLabel: { shrink: true } }}
                    disabled={save.busy}
                    fullWidth
                  />
                  <TextField
                    label="To"
                    type="date"
                    size="small"
                    value={row.to_date}
                    onChange={(event) => update(index, { to_date: event.target.value })}
                    slotProps={{ inputLabel: { shrink: true } }}
                    helperText="Leave blank if this was your job until you joined."
                    disabled={save.busy}
                    fullWidth
                  />
                  <Tooltip title="Remove">
                    <IconButton
                      onClick={() =>
                        setDrafts((current) =>
                          current.filter((_, position) => position !== index),
                        )
                      }
                      disabled={save.busy}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <TextField
                  label="What you did"
                  size="small"
                  value={row.description}
                  onChange={(event) => update(index, { description: event.target.value })}
                  multiline
                  minRows={2}
                  disabled={save.busy}
                  fullWidth
                />
              </Stack>
            </Box>
          ))}

          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setDrafts((current) => [...current, { ...EMPTY }])}
              disabled={save.busy}
            >
              Add a role
            </Button>
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSave}
              disabled={save.busy}
            >
              {save.busy ? 'Saving...' : 'Save'}
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setDrafts(rows.map(toDraft));
                setEditing(false);
              }}
              disabled={save.busy}
            >
              Cancel
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Rows without a title, company and start date are dropped when you save.
          </Typography>
        </Stack>
      )}
    </SectionCard>
  );
}
