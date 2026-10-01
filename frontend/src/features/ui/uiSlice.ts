/** Global UI state: navigation drawer, colour mode, transient toasts. */

import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
}

export interface UiState {
  sidebarOpen: boolean;
  colorMode: 'light' | 'dark';
  toasts: Toast[];
}

/**
 * Open on a desktop, closed on a phone. Below MUI's `md` the drawer is a
 * temporary overlay, so starting it open would cover the page on first paint.
 * 900px is `md`; read defensively because this runs at module scope.
 */
function sidebarStartsOpen(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= 900;
}

const initialState: UiState = {
  sidebarOpen: sidebarStartsOpen(),
  colorMode: (localStorage.getItem('empportal.colorMode') as 'light' | 'dark') ?? 'light',
  toasts: [],
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen(state, action: PayloadAction<boolean>) {
      state.sidebarOpen = action.payload;
    },
    toggleColorMode(state) {
      state.colorMode = state.colorMode === 'light' ? 'dark' : 'light';
      localStorage.setItem('empportal.colorMode', state.colorMode);
    },
    showToast: {
      reducer(state, action: PayloadAction<Toast>) {
        state.toasts.push(action.payload);
      },
      prepare(message: string, severity: ToastSeverity = 'info') {
        return { payload: { id: nanoid(), message, severity } };
      },
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((toast) => toast.id !== action.payload);
    },
  },
});

export const { toggleSidebar, setSidebarOpen, toggleColorMode, showToast, dismissToast } =
  uiSlice.actions;
export default uiSlice.reducer;

interface WithUi {
  ui: UiState;
}

export const selectSidebarOpen = (state: WithUi) => state.ui.sidebarOpen;
export const selectColorMode = (state: WithUi) => state.ui.colorMode;
export const selectToasts = (state: WithUi) => state.ui.toasts;
