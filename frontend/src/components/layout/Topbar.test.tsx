/**
 * The top bar is `position: fixed`, which takes it out of the flex row the
 * sidebar lives in — so it does not know the sidebar is there and spans the
 * whole window, with the drawer painted over its first 248 pixels. That hid the
 * menu button and clipped the title to "...nt Portal".
 *
 * These tests pin the fix: the bar starts where the sidebar ends, and reclaims
 * the space when the sidebar is closed.
 *
 * The offset is now `md`-and-up only. Below that the drawer is a temporary
 * overlay that floats over the page rather than displacing it, so the same
 * margin would have pushed the bar off a phone screen entirely — which it did.
 * jsdom does not evaluate media queries in `getComputedStyle`, so the two
 * responsive assertions read the emitted stylesheet instead.
 */

import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import { SIDEBAR_WIDTH } from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import { makeUser } from '@/test/fixtures';

function renderTopbar(sidebarOpen: boolean) {
  const store = createStore({
    auth: { user: makeUser(), status: 'authenticated', error: null } as never,
    ui: { sidebarOpen, colorMode: 'light', toasts: [] } as never,
  });

  const { container } = render(
    <Provider store={store}>
      <MemoryRouter>
        <Topbar onToggleSidebar={vi.fn()} />
      </MemoryRouter>
    </Provider>,
  );
  return container.querySelector('header')!;
}

/**
 * The emotion rules for `header`, split by breakpoint.
 *
 * Emotion appends to one stylesheet for the whole document, so earlier renders
 * in this file leave their classes behind - the assertions have to be scoped
 * to the class this render actually produced. MUI emits the `xs` value into a
 * `min-width:0px` block and the `md` value into `min-width:900px`, which is
 * precisely the split under test.
 */
function rulesFor(header: Element): { mobile: string; desktop: string } {
  const css = Array.from(document.querySelectorAll('style'))
    .map((tag) => tag.textContent ?? '')
    .join('')
    .replace(/\s+/g, '');

  const classes = Array.from(header.classList).filter((name) => name.startsWith('css-'));

  // Plain string slicing rather than a regex: class names contain hyphens and
  // the rule bodies contain braces, and escaping both through a template
  // literal is how this helper got written wrong the first time.
  const pick = (minWidth: string) =>
    classes
      .map((name) => {
        const opener = `@media(min-width:${minWidth}){.${name}{`;
        const start = css.indexOf(opener);
        if (start === -1) return '';
        const from = start + opener.length;
        const end = css.indexOf('}', from);
        return end === -1 ? '' : css.slice(from, end);
      })
      .join('');

  return { mobile: pick('0px'), desktop: pick('900px') };
}

describe('Topbar layout', () => {
  it('starts where the sidebar ends while it is open, from md up', () => {
    const { desktop } = rulesFor(renderTopbar(true));

    expect(desktop).toContain(`margin-left:${SIDEBAR_WIDTH}px`);
    expect(desktop).toContain(`width:calc(100%-${SIDEBAR_WIDTH}px)`);
  });

  it('takes the whole width back when the sidebar is closed', () => {
    const { desktop } = rulesFor(renderTopbar(false));

    expect(desktop).toContain('margin-left:0px');
    expect(desktop).toContain('width:100%');
  });

  it('never offsets the bar on a phone, even with the drawer open', () => {
    // Below md the drawer overlays the page instead of displacing it, so the
    // same offset used to slide the bar off a 390px screen entirely.
    const { mobile } = rulesFor(renderTopbar(true));

    expect(mobile).toContain('margin-left:0px');
    expect(mobile).toContain('width:100%');
    expect(mobile).not.toContain(`${SIDEBAR_WIDTH}px`);
  });

  it('shows the whole title, not a clipped one', () => {
    renderTopbar(true);
    expect(screen.getByText('Employee Management Portal')).toBeInTheDocument();
  });

  it('keeps the menu button reachable', () => {
    renderTopbar(true);
    expect(screen.getByRole('button', { name: /toggle navigation/i })).toBeInTheDocument();
  });

  it('brings the brand mark into the bar when the sidebar is hidden', () => {
    renderTopbar(false);
    expect(screen.getByRole('img', { name: /trigyan/i })).toBeInTheDocument();
  });
});
