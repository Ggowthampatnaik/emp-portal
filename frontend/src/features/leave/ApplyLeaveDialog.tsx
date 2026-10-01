/**
 * Apply for leave. The day count is computed by the backend, but the dialog
 * previews it (weekends and mandatory holidays excluded) so the employee sees
 * the cost before submitting.
 */

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useMemo, useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { leaveApi } from '@/services/api/services';
import type { DayPart, PersonSearchResult } from '@/types/domain';
import { fromIsoDate, toIsoDate, todayIso } from '@/utils/date';
import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import PeoplePicker from '@/components/common/PeoplePicker';

interface Props {
  open: boolean;
  onClose: () => void;
  onApplied: () => void;
}

const DAY_PARTS: { value: DayPart; label: string }[] = [
  { value: 'full', label: 'Full day(s)' },
  { value: 'first_half', label: 'First half (single date)' },
  { value: 'second_half', label: 'Second half (single date)' },
];

const today = todayIso;

/** Working days between two ISO dates, excluding weekends and given holidays. */
function previewDays(
  start: string,
  end: string,
  dayPart: DayPart,
  holidays: Set<string>,
): number {
  if (!start || !end) return 0;
  const from = fromIsoDate(start);
  const to = fromIsoDate(end);
  if (to < from) return 0;

  let count = 0;
  for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
    const iso = toIsoDate(cursor);
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(iso)) count += 1;
  }
  if (count === 0) return 0;
  return dayPart === 'full' ? count : 0.5;
}

export default function ApplyLeaveDialog({ open, onClose, onApplied }: Props) {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState({
    leave_type: '',
    start_date: today(),
    end_date: today(),
    day_part: 'full' as DayPart,
    reason: '',
  });
  // Held as whole rows so the chips keep their names without another lookup.
  const [cc, setCc] = useState<PersonSearchResult[]>([]);

  const types = useApiResource(
    useCallback(() => leaveApi.types({ is_active: true, page_size: 50 }), []),
    [],
  );
  // Entitlement is per calendar year, so the balance that matters is the one
  // for the year the leave falls in - booking January in December spends next
  // year's days, and showing this year's here would simply be wrong.
  const bookingYear = Number(form.start_date.slice(0, 4)) || new Date().getFullYear();
  const balances = useApiResource(
    useCallback(() => leaveApi.myBalances(bookingYear), [bookingYear]),
    [bookingYear],
  );
  const holidays = useApiResource(
    useCallback(() => leaveApi.holidays(new Date().getFullYear()), []),
    [],
  );

  const apply = useApiAction(leaveApi.apply);

  const mandatoryHolidays = useMemo(
    () =>
      new Set(
        (holidays.data?.results ?? [])
          .filter((holiday) => !holiday.is_optional)
          .map((holiday) => holiday.date),
      ),
    [holidays.data],
  );

  const days = previewDays(form.start_date, form.end_date, form.day_part, mandatoryHolidays);
  const selectedBalance = (balances.data ?? []).find(
    (balance) => String(balance.leave_type) === form.leave_type,
  );
  const exceedsBalance = Boolean(
    selectedBalance && days > Number(selectedBalance.available_days),
  );

  const set = (field: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => {
      const next = { ...prev, [field]: event.target.value };
      // A half day applies to one date only.
      if (field === 'day_part' && event.target.value !== 'full')
        next.end_date = next.start_date;
      if (field === 'start_date' && next.day_part !== 'full')
        next.end_date = event.target.value;
      if (field === 'start_date' && next.end_date < event.target.value) {
        next.end_date = event.target.value;
      }
      return next;
    });

  const handleSubmit = async () => {
    const created = await apply.run({
      leave_type: Number(form.leave_type),
      start_date: form.start_date,
      end_date: form.end_date,
      day_part: form.day_part,
      reason: form.reason,
      cc_user_ids: cc.map((person) => person.user_id),
    });
    if (created) {
      dispatch(
        showToast(
          `Leave requested: ${created.total_days} day(s), pending approval.`,
          'success',
        ),
      );
      setForm({ ...form, reason: '' });
      setCc([]);
      onApplied();
    }
  };

  const fieldProps = (field: string) => ({
    error: Boolean(apply.fieldErrors[field]),
    helperText: apply.fieldErrors[field] ?? ' ',
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <ClosableDialogTitle onClose={onClose}>Apply for leave</ClosableDialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {apply.error && !Object.keys(apply.fieldErrors).length && (
            <Alert severity="error" onClose={apply.clearError}>
              {apply.error.message}
            </Alert>
          )}

          <TextField
            select
            label="Leave type"
            value={form.leave_type}
            onChange={set('leave_type')}
            required
            {...fieldProps('leave_type')}
          >
            {(types.data?.results ?? [])
              // A type with no balance row does not exist for this person -
              // the server opens one for every type they qualify for, so a
              // missing row means a gender-restricted policy (maternity
              // leave) that would only be refused on submit.
              .filter((type) => (balances.data ?? []).some((row) => row.leave_type === type.id))
              .map((type) => {
                const balance = (balances.data ?? []).find((row) => row.leave_type === type.id);
                return (
                  <MenuItem key={type.id} value={String(type.id)}>
                    {type.name}
                    {balance
                      ? ` — ${balance.available_days} day(s) available in ${bookingYear}`
                      : ''}
                  </MenuItem>
                );
              })}
          </TextField>

          <TextField
            select
            label="Duration"
            value={form.day_part}
            onChange={set('day_part')}
            helperText=" "
          >
            {DAY_PARTS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {/* Leave is asked for, not reported, so the calendar starts at
                today - the server refuses an earlier date outright and the
                picker should not offer one. Today itself is allowed: somebody
                who wakes up ill applies that morning. */}
            <TextField
              label="From"
              type="date"
              value={form.start_date}
              onChange={set('start_date')}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today() } }}
              fullWidth
              required
              {...fieldProps('start_date')}
            />
            <TextField
              label="To"
              type="date"
              value={form.end_date}
              onChange={set('end_date')}
              slotProps={{
                inputLabel: { shrink: true },
                // Never before the day it starts on.
                htmlInput: { min: form.start_date || today() },
              }}
              disabled={form.day_part !== 'full'}
              fullWidth
              required
              {...fieldProps('end_date')}
            />
          </Stack>

          <Alert severity={days === 0 ? 'warning' : exceedsBalance ? 'error' : 'info'}>
            {days === 0
              ? 'The selected dates contain no working days — weekends and company holidays do not consume leave.'
              : exceedsBalance
                ? `This request needs ${days} day(s) but only ${selectedBalance?.available_days} are available in ${bookingYear}.`
                : `This request will use ${days} working day(s).`}
            {bookingYear !== new Date().getFullYear() && days > 0 && (
              <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                Counted against your {bookingYear} entitlement.
              </Typography>
            )}
          </Alert>

          <TextField
            label="Reason"
            value={form.reason}
            onChange={set('reason')}
            multiline
            minRows={2}
            required
            // No length hint under the box. `fieldProps` still surfaces the
            // server's message if what was written is too short, which is the
            // moment it is worth saying - and every other field in this dialog
            // behaves the same way.
            {...fieldProps('reason')}
          />
          <PeoplePicker
            value={cc}
            onChange={setCc}
            label="Copy in (optional)"
            max={10}
            helperText={
              apply.fieldErrors.cc_user_ids ??
              'They are told the request exists. It gives them no say in it and no access to it.'
            }
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={apply.busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={apply.busy || !form.leave_type || !form.reason || days === 0}
        >
          {apply.busy ? 'Submitting...' : 'Submit request'}
        </Button>
      </DialogActions>
      <Typography variant="caption" color="text.secondary" sx={{ px: 3, pb: 2 }}>
        Your reporting manager is notified as soon as you submit, and HR confirms it after they
        approve.
      </Typography>
    </Dialog>
  );
}
