/**
 * The Complete Profile wizard — the first thing a new employee ever sees (F18).
 *
 * HR creates the account and hands over temporary credentials; the employee
 * signs in, is forced to change the password, and lands here. Until this is
 * finished the portal is shut, on the server as well as in the SPA, so the copy
 * has to explain *why* someone is being asked rather than just demanding it.
 *
 * Only what the business genuinely needs is mandatory. Skills, education
 * certificates and previous jobs are all useful and none of them should stand
 * between somebody and their first day, so they live on My Profile afterwards.
 */

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAppDispatch } from '@/app/hooks';
import Logo from '@/components/common/Logo';
import { ErrorAlert } from '@/components/common/Feedback';
import { restoreSession } from '@/features/auth/authSlice';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import { BLOOD_GROUPS } from '@/types/domain';
import { ambientBackground } from '@/styles/theme';

const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
  { value: 'undisclosed', label: 'Prefer not to say' },
];

/** The three steps, and which fields belong to each. */
const STEPS = [
  {
    label: 'About you',
    caption: 'How to reach you, and who you are on paper.',
    fields: ['phone', 'date_of_birth', 'gender', 'blood_group'] as const,
  },
  {
    label: 'Where you live',
    caption: 'Your address of record, and where you are now.',
    fields: ['permanent_address', 'current_address'] as const,
  },
  {
    label: 'In an emergency',
    caption: 'Who we should call. Nobody else sees this.',
    fields: ['emergency_contact_name', 'emergency_contact_phone'] as const,
  },
];

type Field = (typeof STEPS)[number]['fields'][number];

const EMPTY: Record<Field, string> = {
  phone: '',
  date_of_birth: '',
  gender: '',
  blood_group: '',
  permanent_address: '',
  current_address: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
};

const LABELS: Record<Field, string> = {
  phone: 'Mobile number',
  date_of_birth: 'Date of birth',
  gender: 'Gender',
  blood_group: 'Blood group',
  permanent_address: 'Permanent address',
  current_address: 'Current address',
  emergency_contact_name: 'Emergency contact name',
  emergency_contact_phone: 'Emergency contact number',
};

export default function CompleteProfilePage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Record<Field, string>>(EMPTY);
  const [prefilled, setPrefilled] = useState(false);

  const me = useApiResource(
    useCallback(() => employeesApi.me(), []),
    [],
  );
  const save = useApiAction(employeesApi.completeProfile);
  const draft = useApiAction(employeesApi.profileDraft);

  // A draft saved last time comes back into the form, so leaving halfway
  // costs nothing but the walk back to the door.
  if (me.data && !prefilled) {
    setPrefilled(true);
    setForm((current) => {
      const restored = { ...current };
      for (const field of Object.keys(EMPTY) as Field[]) {
        const stored = me.data?.[field];
        if (stored) restored[field] = String(stored);
      }
      return restored;
    });
  }

  const handleSaveDraft = async () => {
    if (!me.data) return;
    const body: Record<string, string> = {};
    for (const [field, value] of Object.entries(form)) {
      if (value.trim()) body[field] = value.trim();
    }
    const saved = await draft.run(me.data.id, body);
    if (saved) {
      dispatch(
        showToast('Draft saved. Sign back in whenever you like and pick up here.', 'success'),
      );
    }
  };

  const set = (field: Field) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const stepIsComplete = (index: number) =>
    STEPS[index]!.fields.every((field) => form[field].trim().length > 0);

  const handleFinish = async () => {
    if (!me.data) return;
    const saved = await save.run(me.data.id, form);
    if (saved) {
      // The gate is keyed on the flag in /auth/me, so the session has to be
      // refreshed before the portal will let anyone through.
      await dispatch(restoreSession());
      dispatch(showToast(`Welcome aboard, ${saved.first_name}.`, 'success'));
      navigate('/', { replace: true });
    }
  };

  if (me.loading) return <LinearProgress />;

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
        bgcolor: 'background.default',
        // The same ambient wash as the app shell, so the step before signing
        // in (or the first form a new joiner sees) reads as the same product.
        backgroundImage: (theme) => ambientBackground(theme.palette.mode),
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 620 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Box sx={{ mb: 3 }}>
            <Logo size={52} />
          </Box>

          <Typography variant="h3" component="h1" gutterBottom>
            Welcome{me.data ? `, ${me.data.first_name}` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Before the portal opens, we need a few details. It takes a minute and you will not
            be asked again. Everything else about your profile can wait until later.
          </Typography>

          {me.error && <ErrorAlert error={me.error} onRetry={me.reload} />}
          {save.error && !Object.keys(save.fieldErrors).length && (
            <ErrorAlert error={save.error} />
          )}

          <Stepper activeStep={step} sx={{ mb: 3 }}>
            {STEPS.map((entry, index) => (
              <Step key={entry.label} completed={index < step && stepIsComplete(index)}>
                <StepLabel>{entry.label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {current.caption}
          </Typography>

          <Stack spacing={2}>
            {current.fields.map((field) => {
              const shared = {
                label: LABELS[field],
                value: form[field],
                onChange: set(field),
                required: true,
                fullWidth: true,
                error: Boolean(save.fieldErrors[field]),
                helperText: save.fieldErrors[field] ?? ' ',
              };

              if (field === 'gender') {
                return (
                  <TextField key={field} select {...shared}>
                    {GENDERS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                );
              }
              if (field === 'blood_group') {
                return (
                  <TextField
                    key={field}
                    select
                    {...shared}
                    helperText={save.fieldErrors[field] ?? 'Kept for emergencies only.'}
                  >
                    {BLOOD_GROUPS.map((group) => (
                      <MenuItem key={group} value={group}>
                        {group}
                      </MenuItem>
                    ))}
                  </TextField>
                );
              }
              if (field === 'date_of_birth') {
                return (
                  <TextField
                    key={field}
                    type="date"
                    {...shared}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                );
              }
              if (field.endsWith('address')) {
                return <TextField key={field} multiline minRows={2} {...shared} />;
              }
              return <TextField key={field} {...shared} />;
            })}
          </Stack>

          <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ mt: 3 }}>
            <Button onClick={() => setStep((value) => value - 1)} disabled={step === 0}>
              Back
            </Button>

            {/* Leaving midway must not cost what was typed - but only a full
                submit opens the portal. */}
            <Button
              onClick={handleSaveDraft}
              disabled={draft.busy || Object.values(form).every((value) => !value.trim())}
            >
              {draft.busy ? 'Saving...' : 'Save draft'}
            </Button>

            {isLast ? (
              <Button
                variant="contained"
                startIcon={<CheckCircleIcon />}
                onClick={handleFinish}
                disabled={save.busy || !stepIsComplete(step)}
              >
                {save.busy ? 'Saving...' : 'Finish and open the portal'}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={() => setStep((value) => value + 1)}
                disabled={!stepIsComplete(step)}
              >
                Next
              </Button>
            )}
          </Stack>

          {draft.error && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              The draft could not be saved —{' '}
              {Object.values(draft.fieldErrors)[0] ?? draft.error.message}
            </Alert>
          )}

          {save.error && Object.keys(save.fieldErrors).length > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Something above still needs filling in — check the earlier steps.
            </Alert>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
