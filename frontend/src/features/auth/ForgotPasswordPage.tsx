/**
 * "I've forgotten my password."
 *
 * The server answers the same way whether or not the address exists, and this
 * page has to keep that promise — if it said "no such account" for one and
 * "check your email" for the other, the endpoint's careful silence would be
 * undone by the screen in front of it. So the confirmation never names the
 * address as known: it says what happens *if* there is an account.
 */

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import { LogoLockup } from '@/components/common/Logo';
import { useApiAction } from '@/hooks/useApiResource';
import { authService } from '@/services/auth/authService';
import { ambientBackground } from '@/styles/theme';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  // The endpoint answers 204 with no body, so the call resolves to `undefined`
  // - which is also what `run` returns when it swallows an error. Returning a
  // value of our own is what tells the two apart.
  const request = useApiAction(async (address: string) => {
    await authService.forgotPassword(address);
    return true as const;
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (await request.run(email.trim())) setSent(true);
  };

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
      <Card sx={{ width: '100%', maxWidth: 440 }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ mb: 3 }}>
            <LogoLockup size={56} align="center" />
          </Box>

          {sent ? (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <MarkEmailReadIcon color="success" />
                <Typography variant="h3" component="h1">
                  Check your email
                </Typography>
              </Stack>
              <Alert severity="success">
                If <strong>{email}</strong> belongs to an active account, a temporary password
                is on its way.
              </Alert>
              <Typography variant="body2" color="text.secondary">
                It works once, and only for the next 30 minutes. Signing in with it will ask you
                to choose a new password straight away.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Nothing arrived? Check the spam folder, then try again — or ask HR, who can
                issue one directly.
              </Typography>
              <Button component={RouterLink} to="/login" startIcon={<ArrowBackIcon />}>
                Back to sign in
              </Button>
            </Stack>
          ) : (
            <Stack component="form" spacing={2} onSubmit={handleSubmit}>
              <Typography variant="h3" component="h1">
                Forgotten your password?
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Enter your work email address and we will send you a temporary password.
              </Typography>

              {request.error && (
                <Alert severity="error" onClose={request.clearError}>
                  {request.error.message}
                </Alert>
              )}

              <TextField
                label="Work email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoFocus
                required
                fullWidth
                error={Boolean(request.fieldErrors.email)}
                helperText={request.fieldErrors.email ?? ' '}
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={request.busy || !email.trim()}
              >
                {request.busy ? 'Sending...' : 'Send temporary password'}
              </Button>

              <Button component={RouterLink} to="/login" startIcon={<ArrowBackIcon />}>
                Back to sign in
              </Button>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
