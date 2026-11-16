import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PropTypes from 'prop-types';
import { MAP_INFO_ID, mediaImageUrl, poiPreviewPlugins } from '../../../src/plugins/poiPreviewPlugin.tsx';
import { MAP_CLICK_DELAY_MS, registerPanelCloseHandler, resetSheet } from '../../../src/plugins/sitePanelState.ts';

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

    it('gives the tour numbers only to a map that numbers every pin (AlMadar-Digital/platform#549)', () => {
      expect(
        mapStateToProps(state({ numberPins: true, site: true }), { id: 'cw', windowId: 'window' }).tourNumbers,
      ).toBeInstanceOf(Map);
      expect(mapStateToProps(state({ site: true }), { id: 'cw', windowId: 'window' }).tourNumbers).toBeNull();
      expect(
        poiPreviewPlugins[1].mapStateToProps(state({ numberPins: true, site: true }), { windowId: 'window' }).numberPins,
      ).toBe(true);
      expect(poiPreviewPlugins[1].mapStateToProps(state({ site: true }), { windowId: 'window' }).numberPins).toBe(false);
    });

    it('is on only when the config asks for it', () => {
      expect(mapStateToProps(state({ site: true }), { id: 'cw', windowId: 'window' }).site).toBe(true);
      expect(mapStateToProps(state({}), { id: 'cw', windowId: 'window' }).site).toBe(false);
      expect(mapStateToProps(state(undefined), { id: 'cw', windowId: 'window' }).site).toBe(false);
    });

    it("passes the host's initialView to the map it opens, never to a nested map (#504)", () => {
      const overlayState = poiPreviewPlugins[1].mapStateToProps;
      const nested = (maps) => ({ ...state(maps), windows: { window: { mapHistory: [{ manifestId: 'parent' }] } } });

      expect(overlayState(state({ initialView: 'halfway', site: true }), { windowId: 'window' }).initialView).toBe('halfway');
      expect(overlayState(state({ initialView: 'sideways', site: true }), { windowId: 'window' }).initialView).toBe('fill');
      expect(overlayState(state({ site: true }), { windowId: 'window' }).initialView).toBe('fill');
      expect(overlayState(nested({ initialView: 'firstPoi', site: true }), { windowId: 'window' }).initialView).toBe('fill');
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

    it('is not a pointer target itself: pressing a card selects nothing (AlMadar-Digital/platform#549)', async () => {
      const selectAnnotation = vi.fn();
      const { container } = render(
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

      /* eslint-disable testing-library/no-container, testing-library/no-node-access -- the class names are the contract */
      const card = container.querySelectorAll('.dbf-map-poi')[1];
      await userEvent.click(card.querySelector('.dbf-map-poi__text'));
      /* eslint-enable testing-library/no-container, testing-library/no-node-access */

      expect(card).not.toHaveAttribute('data-action');
      expect(selectAnnotation).not.toHaveBeenCalled();
    });

    it('numbers its stops by the tour on a map that numbers every pin (AlMadar-Digital/platform#549)', () => {
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
          tourNumbers={
            new Map([
              ['a', 3],
              ['b', 4],
            ])
          }
          windowId="window"
        />,
      );

      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the class name is the contract
      const markers = [...container.querySelectorAll('.dbf-map-poi__marker')].map((marker) => marker.textContent);
      expect(markers).toEqual(['3', '4']);
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

    it('tells the map when it is closed, so the selection clears and the view returns (AlMadar-Digital/platform#549)', async () => {
      const removeCompanionWindow = vi.fn();
      const onClose = vi.fn();
      const unregister = registerPanelCloseHandler('closing-window', onClose);
      render(
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
          windowId="closing-window"
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Close panel' }));

      expect(onClose).toHaveBeenCalledTimes(1);
      // Nothing animates the panel here, so it is removed at once.
      expect(removeCompanionWindow).toHaveBeenCalledWith('closing-window', 'cw');
      unregister();
    });
  });

  describe('one panel for whatever it shows (AlMadar-Digital/platform#549)', () => {
    const pois = [stop('a', 'The Start', 1), stop('b', 'Manzil Qastal', 2)];
    const lonePoi = (id, title) => ({ body: [text('en', 'identifying', title)], 'dbf:kind': 'POI', id });
    const preview = (props) => (
      <PreviewContent
        annotation={null}
        id="cw"
        journeyPois={[]}
        locale="en"
        position="right"
        removeCompanionWindow={vi.fn()}
        selectAnnotation={vi.fn()}
        site
        windowId="window"
        {...props}
      />
    );
    /* eslint-disable testing-library/no-container, testing-library/no-node-access -- the elements themselves are under test */
    const parts = (container) => ({
      body: container.querySelector('.dbf-map-panel__body'),
      content: container.querySelector('.dbf-map-panel__content'),
      panel: container.querySelector('section'),
    });

    it('keeps the panel and gives it new content, from the introduction to a POI to a journey and back', () => {
      const mapInfo = { summary: '', title: 'Map of the Nile' };
      const { container, rerender } = render(preview({ mapInfo }));
      const intro = parts(container);
      expect(intro.content).toHaveTextContent('Map of the Nile');
      expect(intro.content.parentElement).toBe(intro.body);

      rerender(preview({ annotation: lonePoi('poi', 'The Well') }));
      const poi = parts(container);
      expect(poi.content).toHaveTextContent('The Well');

      rerender(preview({ annotation: lonePoi('other', 'The Gate') }));
      const otherPoi = parts(container);
      expect(otherPoi.content).toHaveTextContent('The Gate');

      rerender(preview({ annotation: journey, journeyPois: pois, selectedAnnotationId: 'a' }));
      const tour = parts(container);
      expect(tour.content.querySelectorAll('.dbf-map-poi')).toHaveLength(2);

      rerender(preview({ mapInfo }));
      const back = parts(container);

      // The panel never changes: a new one is slid in by the host page, its tools standing still.
      [poi, otherPoi, tour, back].forEach((shown) => {
        expect(shown.panel).toBe(intro.panel);
        expect(shown.body).toBe(intro.body);
      });
      // Its content does, each time: that is what the host fades in.
      const contents = [intro, poi, otherPoi, tour, back].map((shown) => shown.content);
      contents.slice(1).forEach((content, index) => expect(content).not.toBe(contents[index]));
    });

    it("keeps a journey's content from stop to stop: its cards scroll instead", () => {
      const { container, rerender } = render(preview({ annotation: journey, journeyPois: pois, selectedAnnotationId: 'a' }));
      const first = parts(container);

      rerender(preview({ annotation: journey, journeyPois: pois, selectedAnnotationId: 'b' }));

      expect(parts(container).content).toBe(first.content);
      expect(parts(container).panel).toBe(first.panel);
    });

    it('starts new content at its top, and leaves the scroll alone from stop to stop', () => {
      const scroller = document.createElement('div');
      scroller.className = 'mirador-scrollto-scrollable';
      document.body.appendChild(scroller);
      const { rerender, unmount } = render(preview({ mapInfo: { summary: '', title: 'Map of the Nile' } }), {
        container: scroller,
      });

      scroller.scrollTop = 120;
      rerender(preview({ annotation: journey, journeyPois: pois, selectedAnnotationId: 'a' }));
      expect(scroller.scrollTop).toBe(0);

      scroller.scrollTop = 80;
      rerender(preview({ annotation: journey, journeyPois: pois, selectedAnnotationId: 'b' }));
      expect(scroller.scrollTop).toBe(80);

      unmount();
      scroller.remove();
    });
    /* eslint-enable testing-library/no-container, testing-library/no-node-access */
  });

  describe('a click on the map (AlMadar-Digital/platform#481)', () => {
    const [, { component: MapOverlay, mapDispatchToProps }] = poiPreviewPlugins;
    /** Stand-in for AnnotationsOverlay: a button that clicks the map, when it is given the handler */
    function OverlayStub({ onMapClick = null }) {
      return onMapClick ? (
        <button onClick={onMapClick} type="button">
          the map
        </button>
      ) : null;
    }
    OverlayStub.propTypes = { onMapClick: PropTypes.func };

    const overlay = (clearMapSelection, { selectedAnnotationId = null, ...props }) => (
      <MapOverlay
        TargetComponent={OverlayStub}
        addCompanionWindow={vi.fn()}
        clearMapSelection={clearMapSelection}
        targetProps={{ selectedAnnotationId, windowId: 'clicked-window' }}
        updateCompanionWindow={vi.fn()}
        {...props}
      />
    );
    const renderOverlay = (props) => {
      const clearMapSelection = vi.fn();
      const { rerender } = render(overlay(clearMapSelection, props));
      return Object.assign(clearMapSelection, { rerender: (next) => rerender(overlay(clearMapSelection, next)) });
    };

    afterEach(() => vi.useRealTimers());

    it('clears the selection of its window, once it is no double click', () => {
      vi.useFakeTimers();
      const clearMapSelection = renderOverlay({ site: true });

      fireEvent.click(screen.getByRole('button', { name: 'the map' }));
      expect(clearMapSelection).not.toHaveBeenCalled();

      vi.advanceTimersByTime(MAP_CLICK_DELAY_MS);
      expect(clearMapSelection).toHaveBeenCalledTimes(1);
      expect(clearMapSelection).toHaveBeenCalledWith('clicked-window');
      expect(mapDispatchToProps.clearMapSelection).toBeTypeOf('function');
    });

    it('leaves alone a POI picked, or a panel opened, right after the click', () => {
      vi.useFakeTimers();
      const shown = { previewAnnotationId: 'journey', selectedAnnotationId: 'stop-1', site: true };
      const clearMapSelection = renderOverlay(shown);

      // Another stop is selected 100ms after the click on the map.
      fireEvent.click(screen.getByRole('button', { name: 'the map' }));
      vi.advanceTimersByTime(100);
      clearMapSelection.rerender({ ...shown, selectedAnnotationId: 'stop-2' });
      vi.advanceTimersByTime(MAP_CLICK_DELAY_MS);
      expect(clearMapSelection).not.toHaveBeenCalled();

      // The panel moves on to another POI's, the selection aside.
      fireEvent.click(screen.getByRole('button', { name: 'the map' }));
      vi.advanceTimersByTime(100);
      clearMapSelection.rerender({ ...shown, previewAnnotationId: 'poi', selectedAnnotationId: 'stop-2' });
      vi.advanceTimersByTime(MAP_CLICK_DELAY_MS);
      expect(clearMapSelection).not.toHaveBeenCalled();

      // Left alone, a click still counts.
      fireEvent.click(screen.getByRole('button', { name: 'the map' }));
      vi.advanceTimersByTime(MAP_CLICK_DELAY_MS);
      expect(clearMapSelection).toHaveBeenCalledTimes(1);
    });

    it("is the site preset's only: the editor selects what is clicked", () => {
      renderOverlay({ site: false });

      expect(screen.queryByRole('button', { name: 'the map' })).not.toBeInTheDocument();
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
      // Escape elsewhere on the host page leaves the map alone.
      const elsewhere = document.body.appendChild(document.createElement('input'));
      const outside = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' });
      elsewhere.dispatchEvent(outside);
      expect(removeCompanionWindow).not.toHaveBeenCalled();
      expect(outside.defaultPrevented).toBe(false);
      elsewhere.remove();

      const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' });
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the panel's own element
      container.querySelector('.dbf-map-panel__body').dispatchEvent(escape);

      expect(removeCompanionWindow).toHaveBeenCalledWith('window', 'cw');
      expect(escape.defaultPrevented).toBe(true);
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

  describe('eyebrow', () => {
    it("shows a lone POI's eyebrow, and a stop's own eyebrow over its journey's title", () => {
      const lone = { ...stop('l', 'Manzil Qastal', 1), 'dbf:journey': null, 'dbf:eyebrowEn': 'A journey to the coast' };
      const { container, unmount } = render(
        <PreviewContent
          annotation={lone}
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
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the class name is the contract
      expect(container.querySelector('.dbf-map-poi__eyebrow')).toHaveTextContent('A journey to the coast');
      unmount();

      const stops = [{ ...stop('a', 'Muwailih Fort', 1), 'dbf:eyebrowEn': 'The Start' }, stop('b', 'Manzil Qastal', 2)];
      const journeyView = render(
        <PreviewContent
          annotation={journey}
          id="cw"
          journeyPois={stops}
          locale="en"
          position="right"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
        />,
      );
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the class name is the contract
      const eyebrows = [...journeyView.container.querySelectorAll('.dbf-map-poi__eyebrow')].map((el) => el.textContent);
      expect(eyebrows).toEqual(['The Start', 'A journey to the coast']);
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

    it('leaves a POI\'s nested map to its pin: showing the POI opens nothing, and there is no "Open map" button', () => {
      const openNestedMap = vi.fn();
      renderSite({ annotation: nestedPoi, linkedMapManifestId: 'https://example.org/nested', openNestedMap });

      expect(openNestedMap).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Open map' })).not.toBeInTheDocument();
    });

    it('shows the POI it was opened from without opening anything', () => {
      const openNestedMap = vi.fn();
      renderSite({ annotation: nestedPoi, carried: true, openNestedMap });

      expect(screen.getByRole('heading', { name: 'The illuminated frontispiece' })).toBeInTheDocument();
      expect(openNestedMap).not.toHaveBeenCalled();
    });

    it("opens a journey stop's nested map when its card is pressed, not when the stop is selected", async () => {
      const openNestedMap = vi.fn();
      const selectAnnotation = vi.fn();
      const linkedMap = { id: 'nested-doc', manifestId: 'https://example.org/nested' };
      const stops = [stop('a', 'The Start', 1), { ...stop('b', 'Manzil Qastal', 2), 'dbf:linkedMap': linkedMap }];
      renderSite({ annotation: journey, journeyPois: stops, openNestedMap, selectAnnotation, selectedAnnotationId: 'b' });

      // Selected (by a scroll, a swipe or the tour): nothing opens.
      expect(openNestedMap).not.toHaveBeenCalled();

      // The card of a stop with a nested map says it opens something; the other's doesn't.
      /* eslint-disable testing-library/no-node-access -- the attribute is the contract */
      expect(screen.getByRole('button', { name: 'Manzil Qastal' }).closest('.dbf-map-poi')).toHaveAttribute(
        'data-action',
        'open',
      );
      expect(screen.getByRole('button', { name: 'The Start' }).closest('.dbf-map-poi')).not.toHaveAttribute('data-action');
      /* eslint-enable testing-library/no-node-access */

      await userEvent.click(screen.getByRole('button', { name: 'Manzil Qastal' }));
      expect(openNestedMap).toHaveBeenCalledWith('window', 'https://example.org/nested', {
        annotation: stops[1],
        position: 'right',
        previewAnnotationId: 'journey',
        selectedAnnotationId: 'b',
      });

      // A stop without a nested map is just selected.
      await userEvent.click(screen.getByRole('button', { name: 'The Start' }));
      expect(selectAnnotation).toHaveBeenCalledWith('window', 'a');
      expect(openNestedMap).toHaveBeenCalledTimes(1);
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

  describe('media caption (#520)', () => {
    const image = { id: 'img1', source: 'iiif-image', thumbnailUrl: 'https://iiif/full/960,/0/default.jpg', title: 'Folio 1' };
    /** A single POI's card, with the given media in the card's language. */
    const renderPoi = (media, locale = 'en') =>
      render(
        <PreviewContent
          annotation={{
            ...stop('a', 'Cairo', 1),
            'dbf:journey': null,
            [locale === 'ar' ? 'dbf:mediaAr' : 'dbf:mediaEn']: media,
          }}
          id="cw"
          journeyPois={[]}
          locale={locale}
          position="right"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
        />,
      );

    it('lists the caption, credit, rights statement and object link under the image', () => {
      const { container } = renderPoi({
        ...image,
        caption: 'A view of the Nile',
        credit: 'Courtesy QNL',
        rightsStatement: { label: 'In Copyright', uri: 'https://rightsstatements.org/vocab/InC/1.0/' },
        work: { title: 'Book of Roger', url: '/en/objects/25-G2-06-0343' },
      });

      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the class names are the contract
      const figure = container.querySelector('figure.dbf-map-poi__media');
      // eslint-disable-next-line testing-library/no-node-access -- the class names are the contract
      const lines = [...figure.querySelectorAll('.dbf-map-poi__caption > p')];
      expect(lines.map((line) => [line.className, line.textContent])).toEqual([
        ['dbf-map-poi__caption-text', 'A view of the Nile'],
        ['dbf-map-poi__credit', 'Courtesy QNL'],
        ['dbf-map-poi__rights', 'In Copyright'],
        ['dbf-map-poi__work', 'Object details'],
      ]);
      const rights = screen.getByRole('link', { name: 'In Copyright' });
      expect(rights).toHaveAttribute('href', 'https://rightsstatements.org/vocab/InC/1.0/');
      expect(rights).toHaveAttribute('target', '_blank');
      const work = screen.getByRole('link', { name: 'Object details: Book of Roger' });
      expect(work).toHaveAttribute('href', '/en/objects/25-G2-06-0343');
      expect(work).toHaveClass('dbf-map-work__link');
      expect(work).not.toHaveAttribute('target');
    });

    it('shows only the lines the media carries, and no caption block when it carries none', () => {
      const { container, unmount } = renderPoi({ ...image, credit: 'Courtesy QNL' });
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the class names are the contract
      expect([...container.querySelectorAll('.dbf-map-poi__caption > p')].map((line) => line.className)).toEqual([
        'dbf-map-poi__credit',
      ]);
      unmount();

      const bare = renderPoi(image);
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the class names are the contract
      expect(bare.container.querySelector('.dbf-map-poi__media img')).toBeInTheDocument();
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the class names are the contract
      expect(bare.container.querySelector('.dbf-map-poi__caption')).not.toBeInTheDocument();
    });

    it('labels the object link in Arabic on an Arabic card', () => {
      renderPoi({ ...image, work: { title: 'كتاب روجر', url: '/ar/objects/25-G2-06-0343' } }, 'ar');

      expect(screen.getByRole('link', { name: 'تفاصيل القطعة: كتاب روجر' })).toHaveAttribute('href', '/ar/objects/25-G2-06-0343');
    });

    it('links only web addresses and site paths', () => {
      renderPoi({
        ...image,
        // eslint-disable-next-line no-script-url -- the value under test
        rightsStatement: { label: 'In Copyright', uri: 'javascript:alert(1)' },
        // eslint-disable-next-line no-script-url -- the value under test
        work: { title: 'Book of Roger', url: 'javascript:alert(1)' },
      });

      expect(screen.getByText('In Copyright')).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    // Only a stop that opens a nested map has a clickable card (AlMadar-Digital/platform#549):
    // a link inside it must not open that map too.
    it("does not open the stop's nested map when a caption link is followed", async () => {
      const openNestedMap = vi.fn();
      const selectAnnotation = vi.fn();
      const stopWithMedia = {
        ...stop('a', 'Cairo', 1),
        'dbf:linkedMap': { id: 'nested-doc', manifestId: 'https://example.org/nested' },
        'dbf:mediaEn': {
          ...image,
          rightsStatement: { label: 'In Copyright', uri: 'https://rightsstatements.org/vocab/InC/1.0/' },
          work: { title: 'Book of Roger', url: '/en/objects/25-G2-06-0343' },
        },
      };
      render(
        <PreviewContent
          annotation={journey}
          id="cw"
          journeyPois={[stopWithMedia, stop('b', 'Luxor', 2)]}
          locale="en"
          openNestedMap={openNestedMap}
          position="right"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={selectAnnotation}
          site
          windowId="window"
        />,
      );
      const links = [
        screen.getByRole('link', { name: 'Object details: Book of Roger' }),
        screen.getByRole('link', { name: 'In Copyright' }),
      ];
      // jsdom cannot navigate: keep the clicks from trying to.
      links.forEach((link) => link.addEventListener('click', (event) => event.preventDefault()));

      await userEvent.click(links[0]);
      await userEvent.click(links[1]);

      expect(openNestedMap).not.toHaveBeenCalled();
      expect(selectAnnotation).not.toHaveBeenCalled();

      // The card itself still opens the map.
      await userEvent.click(screen.getByRole('button', { name: 'Cairo' }));
      expect(openNestedMap).toHaveBeenCalledTimes(1);
    });
  });
});
