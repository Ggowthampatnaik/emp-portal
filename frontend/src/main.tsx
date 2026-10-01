import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/app/App';
import { AppProviders } from '@/app/providers';
import { isSsoConfigured } from '@/services/auth/msalConfig';
import { msalInstance } from '@/services/auth/msalInstance';
import '@/styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

async function bootstrap(): Promise<void> {
  // MSAL must finish handling any redirect before React mounts.
  if (isSsoConfigured) {
    await msalInstance.initialize();
    await msalInstance.handleRedirectPromise();
  }

  createRoot(container!).render(
    <StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </StrictMode>,
  );
}

void bootstrap();
