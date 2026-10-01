/**
 * The rail's two fixed points: the mark, and what the current page looks like.
 *
 * The logo is the way home in every portal anyone has used, and here it used
 * to be an image and nothing else. It points at "/" rather than at a named
 * dashboard route, which is also what makes it right for Super Admin: that
 * address redirects them to Employees, the same landing the sign-in gives
 * them, so one link is correct for every role.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';

import { createStore } from '@/app/store';
import { setUser } from '@/features/auth/authSlice';
import Sidebar from '@/components/layout/Sidebar';
import { buildTheme } from '@/styles/theme';
import { makeUser, superAdminUser } from '@/test/fixtures';
import type { CurrentUser } from '@/types/auth';

function renderRail(user: CurrentUser, at = '/leave') {
  const store = createStore();
  store.dispatch(setUser(user));
  // The rail reads the theme directly - it decides the logo's artwork from
  // the colour mode, and the drawer's variant from the breakpoint.
  return render(
    <Provider store={store}>
      <ThemeProvider theme={buildTheme('light')}>
        <MemoryRouter initialEntries={[at]}>
          <Sidebar open onClose={() => {}} />
        </MemoryRouter>
      </ThemeProvider>
    </Provider>,
  );
}

describe('the navigation rail', () => {
  it('makes the logo a link home', () => {
    renderRail(makeUser());

    const home = screen.getByRole('link', { name: /go to the dashboard/i });
    expect(home).toHaveAttribute('href', '/');
  });

  it('gives Super Admin the same link, which redirects to their own landing', () => {
    // "/" is the dashboard route; DashboardPage sends a Super Admin on to
    // /employees. One link, correct for every role.
    renderRail(superAdminUser, '/employees');

    expect(screen.getByRole('link', { name: /go to the dashboard/i })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('names the logo for anyone who cannot see it', () => {
    renderRail(makeUser());

    // The mark is an image; without this the link reads as "Trigyan" twice or
    // as nothing at all, depending on the reader.
    expect(screen.getByRole('link', { name: 'Trigyan — go to the dashboard' })).toBeVisible();
  });

  it('marks the page you are on', () => {
    renderRail(makeUser(), '/leave');

    const leave = screen.getByRole('link', { name: 'Leave' });
    expect(leave).toHaveClass('Mui-selected');
  });
});
