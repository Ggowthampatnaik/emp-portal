/**
 * Composition root for every cross-cutting provider: Redux, MSAL, MUI theme,
 * router. Kept separate from App so tests can mount the tree without MSAL.
 */

import { MsalProvider } from '@azure/msal-react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { useMemo, type ReactNode } from 'react';
import { Provider as ReduxProvider } from 'react-redux';

import { useAppSelector } from '@/app/hooks';
import { store } from '@/app/store';
import { selectColorMode } from '@/features/ui/uiSlice';
import { msalInstance } from '@/services/auth/msalInstance';
import { isSsoConfigured } from '@/services/auth/msalConfig';
import { buildTheme } from '@/styles/theme';

function ThemedApp({ children }: { children: ReactNode }) {
  const mode = useAppSelector(selectColorMode);
  const theme = useMemo(() => buildTheme(mode), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const tree = <ThemedApp>{children}</ThemedApp>;

  return (
    <ReduxProvider store={store}>
      {isSsoConfigured ? <MsalProvider instance={msalInstance}>{tree}</MsalProvider> : tree}
    </ReduxProvider>
  );
}
