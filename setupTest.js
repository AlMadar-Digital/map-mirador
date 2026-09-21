import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { setupIntersectionMocking } from 'react-intersection-observer/test-utils';
import i18next from 'i18next';
import createFetchMock from 'vitest-fetch-mock';
import en from './src/locales/en/translation.json';
import localImageManifestFixture from './__tests__/fixtures/version-3/0001-mvm-image.json' with { type: 'json' };
import localSvgAnnotationsFixture from './__tests__/fixtures/version-3/svg-annotations.json' with { type: 'json' };

// vitest doesn't set a default
window.origin = 'http://localhost';

// happy-dom's synthetic document has no real parsed <!doctype html> (it's not
// loading real HTML source), so @hello-pangea/dnd's dev-only doctype check
// always warns here. See https://github.com/hello-pangea/dnd/blob/main/docs/guides/setup-problem-detection-and-error-recovery.md
window['__@hello-pangea/dnd-disable-dev-warnings'] = true;

vi.setConfig({ testTimeout: 10_000 });
const fetchMocker = createFetchMock(vi);
const localIntegrationFixtures = new Map([
  [
    '/__tests__/fixtures/version-3/0001-mvm-image.json',
    JSON.stringify({
      ...localImageManifestFixture,
      items: localImageManifestFixture.items.map((item) => ({
        ...item,
        annotations: item.annotations?.map((annotationPage) => ({
          ...annotationPage,
          id: '/__tests__/fixtures/version-3/svg-annotations.json',
        })),
      })),
    }),
  ],
  ['/__tests__/fixtures/version-3/svg-annotations.json', JSON.stringify(localSvgAnnotationsFixture)],
]);

// changes default behavior of fetchMock to use the real 'fetch' implementation and not mock responses
beforeEach((context) => {
  if (context.task.file.name.includes('/integration')) {
    fetchMocker.enableMocks();
    fetchMocker.dontMock();
    fetchMocker.mockIf(
      (request) => {
        const { pathname } = new URL(request.url);
        return localIntegrationFixtures.has(pathname);
      },
      (request) => {
        const { pathname } = new URL(request.url);
        return {
          body: localIntegrationFixtures.get(pathname),
          headers: { 'Content-Type': 'application/json' },
        };
      },
    );
  } else {
    // sets globalThis.fetch and globalThis.fetchMock to our mocked version
    fetchMocker.enableMocks();
    fetchMocker.doMock();
  }
});

/** */
class Path2D {
  constructor(path) {
    this.path = path;
  }

  arc() {}

  ellipse() {}

  rect() {}

  moveTo() {}

  lineTo() {}

  closePath() {}

  addPath() {}
}

global.Path2D = Path2D;

setupIntersectionMocking(vi.fn);

i18next.init({
  lng: 'en',
  resources: {
    en,
  },
  showSupportNotice: false,
});

// --- Fullscreen mocking ---
const originalCreateElement = document.createElement;

/**
 * Mock requestFullscreen globally for divs (used by FullScreenButton)
 * This simulates an environment where requestFullscreen is supported
 * This is the case for most browsers except iPhone Safari
 */
function mockRequestFullscreen() {
  document.createElement = function createElementMock(tagName) {
    const element = originalCreateElement.call(document, tagName);
    if (tagName === 'div' && typeof element.requestFullscreen !== 'function') {
      element.requestFullscreen = vi.fn(); // Simulate support
    }
    return element;
  };
}

// Restore original createElement method
/**
 *
 */
function disableMockRequestFullscreen() {
  document.createElement = originalCreateElement;
}

// Mock fullscreen support by default
mockRequestFullscreen();

// Expose globally for tests to call when needed
global.__mockRequestFullscreen = mockRequestFullscreen;
global.__disableMockRequestFullscreen = disableMockRequestFullscreen;
