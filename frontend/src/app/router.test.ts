/**
 * Guards the route table itself.
 *
 * Which routes sit inside a RequireAccess wrapper is a permission decision, and
 * it is easy to break silently while moving routes around - the page keeps
 * compiling and only shows 403 at runtime. These assertions pin the intent.
 */

import type { RouteObject } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { router } from '@/app/router';

interface Located {
  route: RouteObject;
  /** True when any ancestor is a permission guard. */
  guarded: boolean;
}

/** Finds a route by its full path, tracking whether a guard wraps it. */
function locate(
  routes: RouteObject[],
  target: string,
  prefix = '',
  guarded = false,
): Located | null {
  for (const route of routes) {
    const isGuard = isRequireAccess(route);
    const path = route.path ? `${prefix}/${route.path}`.replace(/\/+/g, '/') : prefix;

    if (route.path && path === target) {
      return { route, guarded };
    }
    if (route.children) {
      const found = locate(route.children, target, path, guarded || isGuard);
      if (found) return found;
    }
  }
  return null;
}

/** A guard route has no path of its own and renders RequireAccess. */
function isRequireAccess(route: RouteObject): boolean {
  const element = route.element as { type?: { name?: string } } | undefined;
  return !route.path && element?.type?.name === 'RequireAccess';
}

describe('route table', () => {
  it('leaves the company directory open to every signed-in user', () => {
    const found = locate(router.routes, '/employees');
    expect(found, '/employees route is missing').not.toBeNull();
    expect(found?.guarded, '/employees must not sit behind RequireAccess').toBe(false);
  });

  it.each([
    '/employees/:id',
    '/employees/departments',
    '/employees/org-chart',
    '/reports',
    // A single report row on its own page: same reporting permissions as the
    // table it is opened from.
    '/reports/:kind/:rowKey',
    '/administration',
    // Finance is its own module with its own role; nothing else is behind it.
    '/finance',
    // Everybody's leave, not just your own.
    '/leave/on-leave-today',
  ])('keeps %s behind a permission guard', (path) => {
    const found = locate(router.routes, path);
    expect(found, `${path} route is missing`).not.toBeNull();
    expect(found?.guarded, `${path} must stay guarded`).toBe(true);
  });

  it.each([
    '/',
    '/profile',
    '/leave',
    '/leave/requests',
    '/holidays',
    '/timesheets',
    '/projects',
    '/payroll',
    '/notifications',
    // The onboarding wizard: reachable while the profile gate is shut, which
    // is exactly what it is for.
    '/complete-profile',
  ])('leaves %s reachable by any signed-in user', (path) => {
    const found = locate(router.routes, path === '/' ? '/' : path);
    if (path === '/') return; // the index route carries no path of its own
    expect(found?.guarded, `${path} should not be guarded`).toBe(false);
  });
});

describe('projects', () => {
  it('has no separate detail page', () => {
    // A project opens in place under its own row. The route was removed with
    // the page; leaving it behind would give two ways to see one thing, and
    // only one of them maintained.
    expect(locate(router.routes, '/projects/:id'), '/projects/:id should be gone').toBeNull();
    expect(locate(router.routes, '/projects'), '/projects is still the way in').not.toBeNull();
  });
});

describe('my assets', () => {
  it('is reachable by everyone, behind sign-in but no permission guard', () => {
    // Every employee holds something eventually, and the page shows the
    // caller's own register - the server is what scopes it, not a guard here.
    const found = locate(router.routes, '/assets');

    expect(found, '/assets route is missing').not.toBeNull();
    expect(found?.guarded).toBe(false);
    expect(
      router.routes.find((route) => route.path === '/assets'),
      '/assets must sit inside ProtectedRoute, not beside /login',
    ).toBeUndefined();
  });
});

describe('the way back in', () => {
  it('offers a forgotten-password route outside the protected tree', () => {
    const found = locate(router.routes, '/forgot-password');

    expect(found, '/forgot-password route is missing').not.toBeNull();
    expect(found?.guarded).toBe(false);

    // It must sit beside /login rather than inside ProtectedRoute: somebody who
    // cannot sign in cannot be asked to sign in first.
    const top = router.routes.find((route) => route.path === '/forgot-password');
    expect(top, '/forgot-password must be a top-level route').toBeDefined();
  });

  it('has no separate registration route', () => {
    // A new joiner signs in on the login page with their temporary password;
    // the layout forces the change-password step. A second door here would
    // just be a second thing to keep consistent with the first.
    expect(locate(router.routes, '/register')).toBeNull();
  });

  it('keeps change-password inside the protected tree', () => {
    // Signing in with the temporary password is still a sign-in, so this
    // step is authenticated - and the endpoint behind it needs a session.
    const found = locate(router.routes, '/change-password');

    expect(found, '/change-password route is missing').not.toBeNull();
    expect(router.routes.find((route) => route.path === '/change-password')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Every link in the app points at a route that exists
// ---------------------------------------------------------------------------
// This exists because of a shipped bug: the dashboard's birthday card linked to
// `/employees/directory`, which is not a route. It did not 404 — it matched
// `/employees/:id` with an id of "directory", and that route is behind a
// permission guard, so an ordinary employee clicking "View more" got a 403.
//
// A plain "does it match a route" check would have missed it, because it *did*
// match one. The rule that catches it: a link with nothing interpolated into it
// should resolve to a route made entirely of literal segments. If the only way
// it matches is by feeding a word to a `:param`, the link is wrong.
describe('internal links', () => {
  /** Every full route path in the table, e.g. `/employees/:id`. */
  function routePaths(routes: RouteObject[], prefix = ''): string[] {
    return routes.flatMap((route) => {
      const path = route.path ? `${prefix}/${route.path}`.replace(/\/+/g, '/') : prefix;
      // An index route has no path of its own; it *is* whatever its parent
      // resolves to, which is how `/` exists at all.
      const here = route.index
        ? [prefix || '/']
        : route.path && route.path !== '*'
          ? [path]
          : [];
      return [...here, ...(route.children ? routePaths(route.children, path) : [])];
    });
  }

  /** True when `link` matches `route` and consumes no `:param` segment. */
  function matchesLiterally(link: string, route: string): boolean {
    const linkParts = link.split('/').filter(Boolean);
    const routeParts = route.split('/').filter(Boolean);
    if (linkParts.length !== routeParts.length) return false;
    return routeParts.every((part, index) => part === linkParts[index]);
  }

  it('has no link that only resolves by filling in a route parameter', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.tsx') && !full.endsWith('.test.tsx')) files.push(full);
      }
    };
    walk(join(process.cwd(), 'src'));

    const paths = routePaths(router.routes);
    const broken: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Only static links: anything with an interpolation is resolved at
      // runtime and is exactly what the `:param` routes are for.
      for (const match of source.matchAll(/\bto=(?:"|\{")(\/[^"${}]*)"/g)) {
        const link = match[1];
        // A query string or hash is read by the page, not matched by the
        // router, so only the path in front of it has to resolve.
        const path = link.split(/[?#]/)[0] || '/';
        if (!paths.some((route) => matchesLiterally(path, route))) {
          broken.push(`${file.split('src')[1]} -> ${link}`);
        }
      }
    }

    expect(
      broken,
      `these links do not point at a literal route:\n${broken.join('\n')}`,
    ).toEqual([]);
  });
});
