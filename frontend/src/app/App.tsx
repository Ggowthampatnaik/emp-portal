/**
 * Restores an existing session before the router renders, and reacts to the
 * axios interceptor giving up on a token refresh.
 */

import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';

import { useAppDispatch } from '@/app/hooks';
import { router } from '@/app/router';
import { restoreSession, sessionExpired } from '@/features/auth/authSlice';
import { SESSION_EXPIRED_EVENT } from '@/services/api/client';

export default function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    void dispatch(restoreSession());
  }, [dispatch]);

  useEffect(() => {
    const handler = () => dispatch(sessionExpired());
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
  }, [dispatch]);

  return <RouterProvider router={router} />;
}
