import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PropTypes from 'prop-types';
import { MAP_INFO_ID, mediaImageUrl, poiPreviewPlugins } from '../../../src/plugins/poiPreviewPlugin.tsx';
import { resetSheet } from '../../../src/plugins/sitePanelState.ts';

// Only the preview's own content is under test here, not Mirador's companion window chrome.
vi.mock('../../../src/index', async (importOriginal) => {
  /** Stand-in for the connected CompanionWindow: just its title and content */
  function CompanionWindowStub({ children = null, header = true, title }) {
    return (
      <section aria-label={title}>
        {header && <h2>{title}</h2>}
        {children}
      </section>
    );
  }
  CompanionWindowStub.propTypes = { children: PropTypes.node, title: PropTypes.string.isRequired };

  CompanionWindowStub.propTypes.header = PropTypes.bool;
  return { ...(await importOriginal()), ConnectedCompanionWindow: CompanionWindowStub };
});

const [{ component: PreviewContent, mapStateToProps }] = poiPreviewPlugins;

const text = (language, purpose, value) => ({ language, purpose, type: 'TextualBody', value });

const stop = (id, title, order) => ({
  body: [text('en', 'identifying', title), text('en', 'describing', `<p>${title} text</p>`)],
  'dbf:journey': { id: 'journey', order },
  'dbf:kind': 'POI',
  id,
  target: { selector: { type: 'PointSelector', x: 10, y: 10 }, source: 'canvas' },
});

const journey = { body: [text('en', 'identifying', 'A journey to the coast')], 'dbf:kind': 'Journey', id: 'journey' };

describe('poiPreviewPlugin site preset', () => {
  describe('mapStateToProps', () => {
    const state = (maps) => ({
      annotations: {},
      companionWindows: { cw: { annotationid: 'poi' } },
      config: { language: 'en', maps },
      windows: { window: {} },
    });

    it('is on only when the config asks for it', () => {
      expect(mapStateToProps(state({ site: true }), { id: 'cw', windowId: 'window' }).site).toBe(true);
      expect(mapStateToProps(state({}), { id: 'cw', windowId: 'window' }).site).toBe(false);
      expect(mapStateToProps(state(undefined), { id: 'cw', windowId: 'window' }).site).toBe(false);
    });
  });

  describe('journey', () => {
    const pois = [stop('a', 'The Start', 1), stop('b', 'Manzil Qastal', 2)];

    it('renders numbered stop cards with the contract class names', () => {
      const { container } = render(
        <PreviewContent
          annotation={journey}
          id="cw"
          journeyPois={pois}
          locale="en"
          position="right"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
        />,
      );

      expect(screen.getByRole('heading', { name: 'Follow the journey' })).toBeInTheDocument();
      /* eslint-disable testing-library/no-container, testing-library/no-node-access -- the class names are the contract */
      const cards = container.querySelectorAll('.dbf-map-poi');
      expect(cards).toHaveLength(2);
      expect(cards[1].querySelector('.dbf-map-poi__marker')).toHaveTextContent('2');
      expect(cards[1].querySelector('.dbf-map-poi__eyebrow')).toHaveTextContent('A journey to the coast');
      expect(container.querySelectorAll('.dbf-map-poi__divider')).toHaveLength(1);
      expect(container.querySelector('[style]:not([aria-hidden])')).toBeNull();
      /* eslint-enable testing-library/no-container, testing-library/no-node-access */
    });

    it('selects a stop from its title button', async () => {
      const selectAnnotation = vi.fn();
      render(
        <PreviewContent
          annotation={journey}
          id="cw"
          journeyPois={pois}
          locale="en"
          position="right"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={selectAnnotation}
          site
          windowId="window"
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Manzil Qastal' }));

      expect(selectAnnotation).toHaveBeenCalledWith('window', 'b');
    });
  });

  describe('panel', () => {
    it("replaces Mirador's title bar with its own label and close button", async () => {
      const removeCompanionWindow = vi.fn();
      render(
        <PreviewContent
          annotation={journey}
          id="cw"
          journeyPois={[stop('a', 'The Start', 1)]}
          locale="ar"
          position="bottom"
          removeCompanionWindow={removeCompanionWindow}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
        />,
      );

      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 2, name: 'اتبع الرحلة' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'إغلاق اللوحة' }));

      expect(removeCompanionWindow).toHaveBeenCalledWith('window', 'cw');
    });
  });

  describe('keyboard', () => {
    it('Escape closes the open panel before the view', () => {
      const removeCompanionWindow = vi.fn();
      const { container } = render(
        <section className="mirador-window">
          <PreviewContent
            annotation={journey}
            id="cw"
            journeyPois={[stop('a', 'The Start', 1)]}
            locale="en"
            position="right"
            removeCompanionWindow={removeCompanionWindow}
            selectAnnotation={vi.fn()}
            selectedAnnotationId="a"
            site
            windowId="window"
          />
        </section>,
      );
      const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' });
      document.body.dispatchEvent(escape);

      expect(removeCompanionWindow).toHaveBeenCalledWith('window', 'cw');
      expect(escape.defaultPrevented).toBe(true);
      expect(container).toBeTruthy();
    });
  });

  describe('mobile sheet', () => {
    afterEach(() => resetSheet('window'));

    it('steps through its heights from the handle, by click and arrow keys', async () => {
      const { container } = render(
        <PreviewContent
          annotation={journey}
          id="cw"
          journeyPois={[stop('a', 'The Start', 1)]}
          locale="en"
          position="bottom"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
        />,
      );
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the data attribute is the contract
      const body = () => container.querySelector('.dbf-map-panel__body');
      expect(body()).toHaveAttribute('data-snap', 'half');

      await userEvent.click(screen.getByRole('button', { name: 'Expand panel' }));
      expect(body()).toHaveAttribute('data-snap', 'full');

      screen.getByRole('button', { name: 'Shrink panel' }).focus();
      await userEvent.keyboard('{ArrowDown}{ArrowDown}');
      expect(body()).toHaveAttribute('data-snap', 'collapsed');
      expect(screen.getByRole('button', { name: 'Show panel' })).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('Discover the map', () => {
    it('shows the map title and description', () => {
      const { container } = render(
        <PreviewContent
          annotation={null}
          id="cw"
          journeyPois={[]}
          locale="en"
          mapInfo={{ summary: '<p>Charts the <i>Nile</i>.</p>', title: 'Map of the Nile' }}
          position="bottom"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
        />,
      );

      expect(screen.getByRole('heading', { level: 2, name: 'Discover the map' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 3, name: 'Map of the Nile' })).toBeInTheDocument();
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the class name is the contract
      expect(container.querySelector('.dbf-map-poi[data-variant="map"] .dbf-map-poi__text')).toHaveTextContent(
        'Charts the Nile.',
      );
    });

    it('is the preview of the map-info id', () => {
      const state = {
        annotations: {},
        companionWindows: { cw: { annotationid: MAP_INFO_ID, position: 'right' } },
        config: { language: 'ar', maps: { site: true } },
        manifests: {
          m: { json: { label: { ar: ['خريطة النيل'], en: ['Map of the Nile'] }, summary: { en: ['<p>Nile</p>'] } } },
        },
        windows: { window: { manifestId: 'm' } },
      };

      expect(mapStateToProps(state, { id: 'cw', windowId: 'window' }).mapInfo).toEqual({
        summary: '<p>Nile</p>',
        title: 'خريطة النيل',
      });
    });
  });

  describe('nested maps', () => {
    const nestedPoi = { ...stop('n', 'The illuminated frontispiece', 1), 'dbf:journey': null };
    const renderSite = (props) =>
      render(
        <PreviewContent
          id="cw"
          journeyPois={[]}
          linkedMapManifestId={null}
          locale="en"
          position="right"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
          {...props}
        />,
      );

    it('opens a POI\'s nested map as soon as it is shown, with no "Open map" button', () => {
      const openNestedMap = vi.fn();
      renderSite({ annotation: nestedPoi, linkedMapManifestId: 'https://example.org/nested', openNestedMap });

      expect(openNestedMap).toHaveBeenCalledWith('window', 'https://example.org/nested', {
        annotation: nestedPoi,
        position: 'right',
        previewAnnotationId: 'n',
        selectedAnnotationId: 'n',
      });
      expect(screen.queryByRole('button', { name: 'Open map' })).not.toBeInTheDocument();
    });

    it('shows the POI it was opened from without opening anything', () => {
      const openNestedMap = vi.fn();
      renderSite({ annotation: nestedPoi, carried: true, openNestedMap });

      expect(screen.getByRole('heading', { name: 'The illuminated frontispiece' })).toBeInTheDocument();
      expect(openNestedMap).not.toHaveBeenCalled();
    });

    it("opens a journey stop's nested map when the stop is selected", () => {
      const openNestedMap = vi.fn();
      const stops = [stop('a', 'The Start', 1), stop('b', 'Manzil Qastal', 2)];
      renderSite({
        annotation: journey,
        journeyPois: stops,
        openNestedMap,
        selectedAnnotationId: 'b',
        selectedStopLinkedMapManifestId: 'https://example.org/nested',
      });

      expect(openNestedMap).toHaveBeenCalledWith(
        'window',
        'https://example.org/nested',
        expect.objectContaining({ annotation: stops[1], previewAnnotationId: 'journey', selectedAnnotationId: 'b' }),
      );
    });

    it('shows nothing, not "not found", while the map is still loading', () => {
      renderSite({ annotation: null, loading: true, openNestedMap: vi.fn() });

      expect(screen.queryByText(/could not be found/)).not.toBeInTheDocument();
    });
  });

  describe('mediaImageUrl', () => {
    it('shows uploaded images, IIIF images and Media Item thumbnails, not uploaded audio', () => {
      expect(mediaImageUrl({ source: 'upload', thumbnailUrl: 'https://cdn/x/photo.JPG' })).toBe('https://cdn/x/photo.JPG');
      expect(mediaImageUrl({ source: 'upload', thumbnailUrl: 'https://cdn/x/sound.mp3' })).toBeNull();
      expect(mediaImageUrl({ source: 'iiif-image', thumbnailUrl: 'https://iiif/full/400,/0/default.jpg' })).toBe(
        'https://iiif/full/400,/0/default.jpg',
      );
      expect(mediaImageUrl({ source: 'media-item', thumbnailUrl: 'https://img.youtube.com/vi/a/mqdefault.jpg' })).toBe(
        'https://img.youtube.com/vi/a/mqdefault.jpg',
      );
      expect(mediaImageUrl(null)).toBeNull();
    });
  });

  describe('POI', () => {
    it('renders a card under the Discover heading', () => {
      const { container } = render(
        <PreviewContent
          annotation={{ ...stop('a', 'Cairo', 1), 'dbf:journey': null }}
          id="cw"
          journeyPois={[]}
          locale="en"
          position="right"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
        />,
      );

      expect(screen.getByRole('heading', { name: 'Discover the map' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Cairo' })).toBeInTheDocument();
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the class name is the contract
      expect(container.querySelector('.dbf-map-poi__text')).toHaveTextContent('Cairo text');
    });
  });
});
