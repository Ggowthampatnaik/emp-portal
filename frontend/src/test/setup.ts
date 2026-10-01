import '@testing-library/jest-dom/vitest';

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom implements no layout, so it ships no ResizeObserver - and recharts
// asks for one the moment a chart mounts, which would otherwise throw and take
// the whole test file with it. The stub answers once with a plausible size, so
// the charts draw rather than warning that they measure zero; nothing asserts
// on their contents, only on the page around them.
if (!('ResizeObserver' in globalThis)) {
  const RECT = {
    width: 640,
    height: 320,
    top: 0,
    left: 0,
    bottom: 320,
    right: 640,
    x: 0,
    y: 0,
  };

  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe(target: Element) {
      this.callback(
        [{ target, contentRect: RECT } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }

    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});
