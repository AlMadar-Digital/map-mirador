// @vitest-environment jsdom
// jsdom, not happy-dom: like a browser it computes `flex-direction: row` for every element,
// which is what tripped the CMS journey preview (happy-dom leaves it empty).
import { fireEvent, render, screen } from '@testing-library/react';
import PropTypes from 'prop-types';
import { poiPreviewPlugins } from '../../../src/plugins/poiPreviewPlugin.tsx';
import { isRowLayout } from '../../../src/plugins/scrollSelect.ts';

// The companion window stands in as the scrolling panel it is in Mirador.
vi.mock('../../../src/index', async (importOriginal) => {
  /** Stand-in for the connected CompanionWindow: a scrollable panel around its content */
  function CompanionWindowStub({ children = null }) {
    return (
      <div className="mirador-scrollto-scrollable" data-testid="panel">
        {children}
      </div>
    );
  }
  CompanionWindowStub.propTypes = { children: PropTypes.node };

  return { ...(await importOriginal()), ConnectedCompanionWindow: CompanionWindowStub };
});

const [{ component: PreviewContent }] = poiPreviewPlugins;

const text = (language, purpose, value) => ({ language, purpose, type: 'TextualBody', value });
const stop = (id, title, order) => ({
  body: [text('en', 'identifying', title)],
  'dbf:journey': { id: 'journey', order },
  'dbf:kind': 'POI',
  id,
});
const journey = { body: [text('en', 'identifying', 'Down the Nile')], 'dbf:kind': 'Journey', id: 'journey' };
const stops = [stop('a', 'Aswan', 1), stop('b', 'Luxor', 2), stop('c', 'Cairo', 3)];

describe('isRowLayout', () => {
  it('counts only a flex row: every element computes flex-direction: row', () => {
    const element = (style) => {
      const el = document.createElement('div');
      el.setAttribute('style', style);
      return document.body.appendChild(el);
    };
    expect(isRowLayout(element(''))).toBe(false);
    expect(isRowLayout(element('display: flex; flex-direction: column'))).toBe(false);
    expect(isRowLayout(element('display: flex; flex-direction: row'))).toBe(true);
    expect(isRowLayout(element('display: inline-flex'))).toBe(true);
  });
});

describe('journey preview outside the site preset (the CMS editor)', () => {
  it('scrolls the selected stop up to the top of the panel, not the panel to its start', () => {
    const props = {
      annotation: journey,
      id: 'cw',
      journeyPois: stops,
      locale: 'en',
      selectAnnotation: vi.fn(),
      windowId: 'window',
    };
    const { rerender } = render(<PreviewContent {...props} />);
    const panel = screen.getByTestId('panel');
    panel.scrollTo = vi.fn();
    panel.getBoundingClientRect = () => ({ top: 0 });
    // eslint-disable-next-line testing-library/no-node-access -- the stop's card is plain markup
    const card = panel.querySelector('[data-poi-id="b"]');
    card.getBoundingClientRect = () => ({ top: 500 });

    rerender(<PreviewContent {...props} selectedAnnotationId="b" />);

    expect(panel.scrollTo).toHaveBeenCalledWith({ behavior: 'smooth', top: 500 });
  });
});

describe('site preset audio', () => {
  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function play() {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function pause() {
      Object.defineProperty(this, 'paused', { configurable: true, value: true });
      this.dispatchEvent(new Event('pause'));
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const recording = (id, title, url) => ({
    body: [text('en', 'identifying', title)],
    'dbf:kind': 'POI',
    'dbf:mediaEn': { id, mime: 'audio/mpeg', source: 'upload', thumbnailUrl: url, title: `${id}.mp3`, url },
    id,
  });

  it("starts a fresh player when the panel moves on to another POI's recording", () => {
    const props = {
      id: 'cw',
      journeyPois: [],
      locale: 'en',
      position: 'right',
      removeCompanionWindow: vi.fn(),
      selectAnnotation: vi.fn(),
      site: true,
      windowId: 'window',
    };
    const { container, rerender } = render(
      <PreviewContent {...props} annotation={recording('a', 'Aswan', 'https://cdn.example/a.mp3')} />,
    );
    fireEvent.click(screen.getByRole('button', { exact: true, name: 'Play' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();

    rerender(<PreviewContent {...props} annotation={recording('b', 'Luxor', 'https://cdn.example/b.mp3')} />);

    expect(screen.getByRole('group', { name: 'Audio: Luxor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { exact: true, name: 'Play' })).toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the recording's own element
    expect(container.querySelector('audio source')).toHaveAttribute('src', 'https://cdn.example/b.mp3');
  });
});
