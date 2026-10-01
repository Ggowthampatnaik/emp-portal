/**
 * Redux Toolkit store. Feature reducers are registered here as each module
 * lands (employees, projects, leave, timesheet, reports, admin, notifications).
 */

import { combineReducers, configureStore } from '@reduxjs/toolkit';

import authReducer from '@/features/auth/authSlice';
import notificationsReducer from '@/features/notifications/notificationsSlice';
import uiReducer from '@/features/ui/uiSlice';

export const rootReducer = combineReducers({
  auth: authReducer,
  notifications: notificationsReducer,
  ui: uiReducer,
});

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Dates arrive as ISO strings; nothing non-serialisable is dispatched.
        ignoredActions: [],
      },
    }),
  devTools: import.meta.env.DEV,
});

/** Used by tests to build an isolated store with a known starting state. */
export const createStore = (preloadedState?: Partial<RootState>) =>
  configureStore({ reducer: rootReducer, preloadedState });

export type AppStore = typeof store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
