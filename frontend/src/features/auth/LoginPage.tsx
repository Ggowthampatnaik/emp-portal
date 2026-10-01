/**
 * Sign-in page: email and password for local accounts, with Microsoft SSO
 * offered alongside when Entra ID is configured for the environment.
 */

import LoginIcon from '@mui/icons-material/Login';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMsal } from '@azure/msal-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, Link as RouterLink } from 'react-router-dom';

import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { LogoLockup } from '@/components/common/Logo';
import {
  clearAuthError,
  selectAuthError,
  selectAuthStatus,
  selectIsAuthenticated,
  signIn,
  signInWithEntraToken,
} from '@/features/auth/authSlice';
import {
  apiTokenRequest,
  isPasswordSignInEnabled,
  isSsoConfigured,
  loginRequest,
} from '@/services/auth/msalConfig';
import { rememberedEmail } from '@/services/auth/tokenStorage';
import { SLATE } from '@/styles/theme';

/**
 * The backdrop is drawn in CSS from the portal's own palette: the dark Slate
 * ground with the two brand hues as soft pools - the ambient wash's night-time
 * cousin. It replaced a generated cyan-and-navy artwork whose colours appeared
 * nowhere else in the product, which made the front door read as a different
 * site from the rooms behind it. Being CSS, there is nothing to load, nothing
 * to license, and nothing to keep in step with the theme by hand.
 */
const BACKDROP = [
  'radial-gradient(1000px 700px at 12% 8%, rgba(107,155,214,0.30), transparent 60%)',
  'radial-gradient(900px 640px at 88% 92%, rgba(140,198,63,0.16), transparent 62%)',
  'linear-gradient(150deg, #17293F 0%, #0F1622 48%, #142B47 100%)',
].join(', ');

/** What the portal holds, named the way the sidebar names it. */
const HIGHLIGHTS = ['Leave & holidays', 'Timesheets', 'Payslips', 'Projects', 'People'];

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const status = useAppSelector(selectAuthStatus);
  const error = useAppSelector(selectAuthError);

  // A remembered address arrives already filled in, and the box it came from
  // starts ticked - unticking it is how someone says "not on this machine".
  const [email, setEmail] = useState(() => rememberedEmail.get());
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => Boolean(rememberedEmail.get()));
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
  // With SSO live the form is hidden, but a break-glass admin can still reach
  // it at /login?local=1 when Microsoft sign-in itself is unavailable.
  const showPasswordForm =
    isPasswordSignInEnabled || new URLSearchParams(location.search).get('local') === '1';
  if (isAuthenticated) return <Navigate to={redirectTo} replace />;

  const busy = status === 'authenticating';
  const emailInvalid = touched && !email.trim();
  const passwordInvalid = touched && !password;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!email.trim() || !password) return;
    await dispatch(signIn({ email: email.trim().toLowerCase(), password, remember }));
  };

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100vh',
        display: 'grid',
        // Two columns from md up: the welcome copy fills the left, the card
        // takes the right. On a phone there is no room to be clever, so the
        // copy drops away and the card centres alone.
        gridTemplateColumns: { xs: '1fr', md: '1fr minmax(400px, 440px)' },
        alignItems: 'center',
        justifyItems: 'center',
        gap: { md: 8 },
        px: { xs: 2, md: 8, lg: 12 },
        py: 2,
        backgroundColor: SLATE.groundDark,
        backgroundImage: BACKDROP,
      }}
    >
      <Box
        sx={{
          display: { xs: 'none', md: 'block' },
          justifySelf: 'start',
          maxWidth: 560,
        }}
      >
        <Typography
          variant="h1"
          sx={{ color: '#FFFFFF', fontSize: { md: '2.4rem', lg: '2.75rem' }, lineHeight: 1.2 }}
        >
          Your work life, in one place.
        </Typography>
        <Typography sx={{ mt: 2, maxWidth: 460, color: 'rgba(255,255,255,0.72)' }}>
          Apply for leave, fill your timesheet, download payslips and find your people — signed
          in once, from any device.
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 4 }}>
          {HIGHLIGHTS.map((item) => (
            <Box
              key={item}
              sx={{
                px: 1.5,
                py: 0.5,
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.22)',
                bgcolor: 'rgba(255,255,255,0.07)',
                color: 'rgba(255,255,255,0.85)',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {item}
            </Box>
          ))}
        </Stack>
      </Box>

      <Card
        sx={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 440,
          width: '100%',
          backdropFilter: 'blur(6px)',
          backgroundColor: (theme) =>
            theme.palette.mode === 'light' ? 'rgba(255,255,255,0.97)' : 'rgba(24,33,47,0.95)',
          boxShadow: '0 24px 60px rgba(15,30,55,0.35)',
          border: 'none',
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={3}>
            <Box>
              <LogoLockup size={56} align="center" />
              <Typography variant="h3" component="h1" sx={{ mt: 3 }}>
                Employee Portal
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Sign in to manage your profile, leave, timesheets and projects.
              </Typography>
            </Box>

            {error && (
              <Alert severity="error" onClose={() => dispatch(clearAuthError())}>
                {error}
              </Alert>
            )}

            {/* Microsoft first: once SSO is configured it is the way most
                people sign in, and the one that carries MFA. */}
            {isSsoConfigured && <SsoButton busy={busy} remember={remember} />}

            {isSsoConfigured && showPasswordForm && (
              <Divider>
                <Typography variant="caption" color="text.secondary">
                  OR
                </Typography>
              </Divider>
            )}

            {showPasswordForm && (
              <Box component="form" onSubmit={handleSubmit} noValidate>
                <Stack spacing={2}>
                  <TextField
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    error={emailInvalid}
                    helperText={emailInvalid ? 'Enter your work email address.' : ' '}
                    autoComplete="username"
                    autoFocus
                    fullWidth
                    disabled={busy}
                  />
                  <TextField
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    error={passwordInvalid}
                    helperText={passwordInvalid ? 'Enter your password.' : ' '}
                    autoComplete="current-password"
                    fullWidth
                    disabled={busy}
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => setShowPassword((shown) => !shown)}
                              aria-label={showPassword ? 'Hide password' : 'Show password'}
                              edge="end"
                            >
                              {showPassword ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={remember}
                        onChange={(event) => setRemember(event.target.checked)}
                        disabled={busy}
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">Keep me signed in on this device</Typography>
                    }
                    sx={{ alignSelf: 'flex-start', mt: -1 }}
                  />
                  <Button
                    type="submit"
                    variant={isSsoConfigured ? 'outlined' : 'contained'}
                    size="large"
                    startIcon={<LoginIcon />}
                    disabled={busy}
                    fullWidth
                  >
                    {busy ? 'Signing in...' : 'Sign in'}
                  </Button>
                </Stack>
              </Box>
            )}

            {/* There is no separate registration: a new joiner signs in right
                here with the temporary password the admin gave them, and the
                layout walks them straight into choosing their own. */}
            {showPasswordForm && (
              <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                <Typography variant="caption" color="text.secondary">
                  Forgotten your password?
                </Typography>
                <Link component={RouterLink} to="/forgot-password" variant="caption">
                  Send me a temporary one
                </Link>
              </Stack>
            )}

            {/* Whoever cannot get in needs to know who to ask before they
                need to know anything else on this page. */}
            <Divider />
            <Typography variant="caption" color="text.disabled" align="center">
              Trigyan Employee Portal · Trouble signing in? Contact IT support.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}

function SsoButton({ busy, remember }: { busy: boolean; remember: boolean }) {
  const { instance } = useMsal();
  const dispatch = useAppDispatch();
  const [ssoError, setSsoError] = useState<string | null>(null);

  const handleSignIn = async () => {
    try {
      const result = await instance.loginPopup(loginRequest);
      const tokenResult = await instance
        .acquireTokenSilent({ ...apiTokenRequest, account: result.account })
        .catch(() => result);

      if (!tokenResult.accessToken) {
        setSsoError('Microsoft sign-in did not return an access token for the portal API.');
        return;
      }
      await dispatch(
        signInWithEntraToken({ entraAccessToken: tokenResult.accessToken, remember }),
      );
    } catch (err) {
      setSsoError(err instanceof Error ? err.message : 'Microsoft sign-in was cancelled.');
    }
  };

  return (
    <Stack spacing={1}>
      {ssoError && (
        <Alert severity="error" onClose={() => setSsoError(null)}>
          {ssoError}
        </Alert>
      )}
      <Button variant="contained" size="large" onClick={handleSignIn} disabled={busy} fullWidth>
        Sign in with Microsoft
      </Button>
    </Stack>
  );
}
