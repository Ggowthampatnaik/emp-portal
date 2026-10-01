/**
 * Raise a portal account straight from the Admin module.
 *
 * The other way in is employee onboarding, which creates an account *and* an
 * employment record together. This is for the case that has no employment
 * record behind it — a contractor, an auditor, an account raised before the
 * paperwork catches up.
 *
 * What it produces is an ordinary account: the password is hashed by the same
 * code path onboarding uses, and `must_change_password` is set, so the first
 * sign-in lands on the change-password screen exactly as a new joiner's does.
 *
 * The temporary password is shown while it is typed, deliberately. It has to be
 * read out or pasted into a message in the next few seconds, and a masked field
 * that nobody can check is how the wrong password gets sent to someone.
 */

import PersonAddIcon from '@mui/icons-material/PersonAdd';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';

import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';
import { ErrorAlert } from '@/components/common/Feedback';
import { useApiAction } from '@/hooks/useApiResource';
import { adminApi } from '@/services/api/services';
import type { AdminUser } from '@/types/domain';

const MIN_PASSWORD = 8;

export default function AddUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: AdminUser) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [touched, setTouched] = useState(false);

  const create = useApiAction(adminApi.createUser);

  const emailInvalid = touched && !email.trim();
  const passwordShort = touched && password.length < MIN_PASSWORD;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!email.trim() || password.length < MIN_PASSWORD) return;

    const created = await create.run({
      email: email.trim().toLowerCase(),
      temporary_password: password,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
    });
    if (created) onCreated(created);
  };

  return (
    <Dialog open onClose={create.busy ? undefined : onClose} fullWidth maxWidth="sm">
      <ClosableDialogTitle
        onClose={onClose}
        disabled={create.busy}
        subtitle="An account with no employment record. Assign roles afterwards with Roles."
      >
        Add user
      </ClosableDialogTitle>

      <Box component="form" onSubmit={handleSubmit} noValidate>
        <DialogContent dividers>
          <Stack spacing={2}>
            {create.error && !Object.keys(create.fieldErrors).length && (
              <ErrorAlert error={create.error} />
            )}

            <TextField
              label="User email ID"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={emailInvalid || Boolean(create.fieldErrors.email)}
              helperText={
                create.fieldErrors.email ??
                (emailInvalid
                  ? 'Enter the address they will sign in with.'
                  : 'Their sign-in ID.')
              }
              autoComplete="off"
              autoFocus
              fullWidth
              disabled={create.busy}
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="First name (optional)"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                disabled={create.busy}
                fullWidth
              />
              <TextField
                label="Last name (optional)"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                disabled={create.busy}
                fullWidth
              />
            </Stack>

            <TextField
              label="Temporary password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={passwordShort || Boolean(create.fieldErrors.temporary_password)}
              helperText={
                create.fieldErrors.temporary_password ??
                (passwordShort
                  ? `At least ${MIN_PASSWORD} characters.`
                  : 'Shown so you can pass it on. They must change it at first sign-in.')
              }
              autoComplete="off"
              fullWidth
              disabled={create.busy}
            />

            <Alert severity="info">
              They sign in with these, are made to choose their own password, and carry on from
              there. Until you give them a role they will see very little — assign one with the
              Roles control on their row.
            </Alert>
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} disabled={create.busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            startIcon={<PersonAddIcon />}
            disabled={create.busy}
          >
            {create.busy ? 'Creating...' : 'Create user'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
