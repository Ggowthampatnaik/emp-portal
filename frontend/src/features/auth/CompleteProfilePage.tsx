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
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
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
import PhoneNumberInput from '@/components/common/PhoneNumberInput';
import { refreshCurrentUser } from '@/features/auth/authSlice';
import { showToast } from '@/features/ui/uiSlice';
import { useApiAction, useApiResource } from '@/hooks/useApiResource';
import { employeesApi } from '@/services/api/services';
import { BLOOD_GROUPS } from '@/types/domain';
import { BRAND_BACKDROP, SLATE } from '@/styles/theme';
import AddressFields from '@/components/common/AddressFields';
import {
  EMPTY_ADDRESS,
  hasAnyAddress,
  isAddressValid,
  toAddress,
  type AddressDetail,
} from '@/utils/address';
import { birthDateProblem, latestBirthDateIso } from '@/utils/date';
import { phoneProblem } from '@/utils/phone';

/** The employee's own number must be a mobile; an emergency contact's need not. */
const PHONE_FIELDS = { phone: true, emergency_contact_phone: false } as const;
type PhoneField = keyof typeof PHONE_FIELDS;
const isPhoneField = (field: string): field is PhoneField => field in PHONE_FIELDS;

const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'transgender', label: 'Transgender' },
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
    /** Entered field by field (AddressFields), not as two text boxes. */
    addresses: true,
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
  // The addresses are entered field by field; the server builds the one-line
  // address of record from these.
  const [permanent, setPermanent] = useState<AddressDetail>(EMPTY_ADDRESS);
  const [currentHome, setCurrentHome] = useState<AddressDetail>(EMPTY_ADDRESS);
  const [sameAddress, setSameAddress] = useState(false);
  const livesAt = sameAddress ? permanent : currentHome;

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
    const storedPermanent = toAddress(me.data.permanent_address_detail);
    const storedCurrent = toAddress(me.data.current_address_detail);
    setPermanent(storedPermanent);
    setCurrentHome(storedCurrent);
    setSameAddress(
      hasAnyAddress(storedPermanent) &&
        JSON.stringify(storedPermanent) === JSON.stringify(storedCurrent),
    );
  }

  /** Everything but the address text, which the server builds from the parts. */
  const withoutAddressText = () =>
    Object.entries(form).filter(([field]) => !field.endsWith('_address'));

  const handleSaveDraft = async () => {
    if (!me.data) return;
    const body: Record<string, unknown> = {};
    for (const [field, value] of withoutAddressText()) {
      if (value.trim()) body[field] = value.trim();
    }
    // A draft keeps only what has been typed - half an address is fine here.
    const typed = (address: AddressDetail) =>
      Object.fromEntries(Object.entries(address).filter(([, value]) => value.trim()));
    if (hasAnyAddress(permanent)) body.permanent_address_detail = typed(permanent);
    if (hasAnyAddress(livesAt)) body.current_address_detail = typed(livesAt);
    const saved = await draft.run(me.data.id, body);
    if (saved) {
      dispatch(
        showToast('Draft saved. Sign back in whenever you like and pick up here.', 'success'),
      );
    }
  };

  const set = (field: Field) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  const birthProblem = birthDateProblem(form.date_of_birth);

  const stepIsComplete = (index: number) =>
    STEPS[index]!.addresses
      ? isAddressValid(permanent) && isAddressValid(livesAt)
      : STEPS[index]!.fields.every(
          (field) =>
            form[field].trim().length > 0 &&
            !(isPhoneField(field) && phoneProblem(form[field], PHONE_FIELDS[field])) &&
            !(field === 'date_of_birth' && birthProblem),
        );

  const handleFinish = async () => {
    if (!me.data) return;
    const saved = await save.run(me.data.id, {
      ...Object.fromEntries(withoutAddressText()),
      permanent_address_detail: permanent,
      current_address_detail: livesAt,
    });
    if (saved) {
      // The gate is keyed on the flag in /auth/me, so the user has to be
      // re-read before the portal will let anyone through. Quietly: the
      // start-up refresh put "Restoring your session..." on screen in between.
      await dispatch(refreshCurrentUser());
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
        // The sign-in page's backdrop: sign in, set a password, complete the
        // profile - the whole first day is one front door, not three rooms.
        backgroundColor: SLATE.groundDark,
        backgroundImage: BRAND_BACKDROP,
      }}
    >
      <Card
        sx={{
          width: '100%',
          maxWidth: 620,
          // The sign-in card's dress, as on the set-password step before it.
          border: 'none',
          backgroundColor: (theme) =>
            theme.palette.mode === 'light' ? 'rgba(255,255,255,0.97)' : 'rgba(24,33,47,0.95)',
          backdropFilter: 'blur(6px)',
          boxShadow: '0 24px 60px rgba(15,30,55,0.35)',
        }}
      >
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

          {current.addresses && (
            <Stack spacing={2}>
              <Typography variant="subtitle1" component="h2" fontWeight={700}>
                Permanent address
              </Typography>
              <AddressFields idPrefix="permanent" value={permanent} onChange={setPermanent} />

              <Divider />
              <Typography variant="subtitle1" component="h2" fontWeight={700}>
                Current address
              </Typography>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sameAddress}
                    onChange={(event) => setSameAddress(event.target.checked)}
                  />
                }
                label="Same as permanent address"
              />
              {/* Hidden rather than disabled: a second copy of the form, greyed
                  out, reads as something still to do. */}
              {!sameAddress && (
                <AddressFields
                  idPrefix="current"
                  value={currentHome}
                  onChange={setCurrentHome}
                />
              )}
            </Stack>
          )}

          <Stack spacing={2}>
            {current.fields.map((field) => {
              if (current.addresses) return null;
              const shared = {
                label: LABELS[field],
                value: form[field],
                onChange: set(field),
                required: true,
                fullWidth: true,
                error: Boolean(save.fieldErrors[field]),
                helperText: save.fieldErrors[field] ?? ' ',
              };

              if (isPhoneField(field)) {
                return (
                  <PhoneNumberInput
                    key={field}
                    label={LABELS[field]}
                    value={form[field]}
                    onChange={(value) => setForm((prev) => ({ ...prev, [field]: value }))}
                    mobile={PHONE_FIELDS[field]}
                    required
                    serverError={save.fieldErrors[field] ?? draft.fieldErrors[field]}
                    helperText={
                      PHONE_FIELDS[field]
                        ? 'Your mobile number, without the country code.'
                        : 'Mobile or landline, without the country code.'
                    }
                  />
                );
              }
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
                    error={shared.error || Boolean(birthProblem)}
                    helperText={save.fieldErrors[field] ?? birthProblem ?? ' '}
                    slotProps={{
                      inputLabel: { shrink: true },
                      htmlInput: { max: latestBirthDateIso() },
                    }}
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
