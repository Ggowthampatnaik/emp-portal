/**
 * Unread-count slice. Kept in the store so the topbar badge and the
 * notifications page stay in step without prop drilling.
 */

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

import { notificationsApi } from '@/services/api/services';

export interface NotificationsState {
  unread: number;
}

const initialState: NotificationsState = { unread: 0 };

export const refreshUnreadCount = createAsyncThunk<number>(
  'notifications/refreshUnreadCount',
  async () => {
    const { unread } = await notificationsApi.unreadCount();
    return unread;
  },
);

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    clearUnread(state) {
      state.unread = 0;
    },
  },
  extraReducers: (builder) => {
    // Only the fulfilled case is handled: a failed poll must leave the last
    // known count in place rather than blanking the badge.
    builder.addCase(refreshUnreadCount.fulfilled, (state, action) => {
      state.unread = action.payload;
    });
  },
});

export const { clearUnread } = notificationsSlice.actions;
export default notificationsSlice.reducer;

export const selectUnreadCount = (state: { notifications: NotificationsState }) =>
  state.notifications.unread;
