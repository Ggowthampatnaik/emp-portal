/**
 * Password change. Also step two of new-employee registration, because that is
 * the same thing: `must_change_password` is set on the account and the portal
 * stays shut until it is cleared.
 *
 * Changing a password retires every token the account had — the one this page
 * is using included — so a successful change *always* ends in a sign-out. That
 * is enforced on the server; what happens here is only the tidy version of it,
 * dropping the dead token locally instead of letting the next request discover
 * it and report a session expiry over the top of a change that worked.
 *
 * Arriving from registration, the temporary password comes through in router
 * state, so a new joiner is asked only for the password they are choosing.
 */

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { LogoLockup } from '@/components/common/Logo';
import PageHeader from '@/components/common/PageHeader';
import { selectCurrentUser, signedOutLocally } from '@/features/auth/authSlice';
import { useApiAction } from '@/hooks/useApiResource';
import { authService } from '@/services/auth/authService';
import { showToast } from '@/features/ui/uiSlice';

export default function ChangePasswordPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector(selectCurrentUser);
  const location = useLocation();

  /** Passed by the registration screen; absent on a normal visit or a refresh. */
  const carried = (location.state as { temporaryPassword?: string } | null)?.temporaryPassword;
  const activating = user?.must_change_password === true;
  const fromRegistration = activating && Boolean(carried);

  const [current, setCurrent] = useState(carried ?? '');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const action = useApiAction(async (currentPassword: string, newPassword: string) => {
    await authService.changePassword(currentPassword, newPassword);
    // `run` reports failure by resolving undefined, and a 204 has nothing to
    // return - so success has to say so out loud or it reads as a failure.
    return true as const;
  });

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (next !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);

    const result = await action.run(current, next);
    if (result) {
      dispatch(
        showToast('Password updated. Please sign in with your new password.', 'success'),
      );
      dispatch(signedOutLocally());
      navigate('/login', { replace: true });
    }
  };

  const body = (
    <>
      {activating ? (
        <Box sx={{ mb: 3 }}>
          <LogoLockup size={56} align="center" />
          <Typography variant="h3" component="h1" sx={{ mt: 3 }}>
            Set your password
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            Your account uses a temporary password. Choose a new one to continue.
          </Typography>
        </Box>
      ) : (
        <PageHeader
          title="Change password"
          subtitle="Choose a new password for your account."
        />
      )}

      <Card sx={{ maxWidth: 520, width: '100%' }}>
        <CardContent sx={{ p: 3 }}>
          <Stack component="form" onSubmit={handleSubmit} spacing={2} noValidate>
            {activating && (
              <Alert severity="info">
                {fromRegistration
                  ? 'Your temporary password checked out. Choose the password you will use from now on.'
                  : 'A temporary password was issued for this account. Set your own password before using the portal.'}
              </Alert>
            )}
            {action.error && !Object.keys(action.fieldErrors).length && (
              <Alert severity="error" onClose={action.clearError}>
                {action.error.message}
              </Alert>
            )}

            {/* Already supplied a moment ago on the registration screen, so a
                new joiner is not made to type a one-time password twice. */}
            {!fromRegistration && (
              <TextField
                label={activating ? 'Temporary password' : 'Current password'}
                type="password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
                error={Boolean(action.fieldErrors.current_password)}
                helperText={action.fieldErrors.current_password ?? ' '}
                autoComplete="current-password"
                required
                fullWidth
              />
            )}
            {fromRegistration && action.fieldErrors.current_password && (
              <Alert severity="error">
                {action.fieldErrors.current_password} Start again from the registration screen.
              </Alert>
            )}
            <TextField
              label="New password"
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              error={Boolean(action.fieldErrors.new_password)}
              helperText={
                action.fieldErrors.new_password ??
                'At least 8 characters, not entirely numeric, not a common password.'
              }
              autoComplete="new-password"
              required
              fullWidth
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              error={mismatch}
              helperText={mismatch ? 'The two passwords do not match.' : ' '}
              autoComplete="new-password"
              required
              fullWidth
            />

            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained" disabled={action.busy}>
                {action.busy ? 'Saving...' : activating ? 'Set password' : 'Change password'}
              </Button>
              {!activating && (
                <Button variant="text" onClick={() => navigate(-1)} disabled={action.busy}>
                  Cancel
                </Button>
              )}
            </Stack>

            <Typography variant="caption" color="text.secondary">
              Changing your password signs you out everywhere, this device included. Sign in
              again with the new one.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </>
  );

  if (!activating) return body;

  // Mid-onboarding the layout shows no sidebar or topbar, so this page sets
  // its own stage - centred, like the login card that led here.
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 520 }}>{body}</Box>
    </Box>
  );
}
