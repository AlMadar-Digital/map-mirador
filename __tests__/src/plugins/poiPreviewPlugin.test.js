import { OSDReferences } from '../../../src/plugins/OSDReferences';
import {
  ensurePointVisible,
  fitMapToPoints,
  focusMapOnPoint,
  getPoiPoint,
  getPreviewAnnotationId,
  getVisibleMapArea,
} from '../../../src/plugins/poiPreviewPlugin.tsx';

/**
 * A stand-in OpenSeadragon viewport on a 1000x500px container, recording the calls made on it.
 * `bounds` is the part of the map in view, in viewport units.
 */
const fakeViewport = ({ zoom = 1, homeZoom = 1, maxZoom = 100, bounds = { height: 500, width: 1000, x: 0, y: 0 } } = {}) => ({
  fitBounds: vi.fn(),
  getContainerSize: () => ({ x: 1000, y: 500 }),
  getHomeBounds: () => ({ height: 1000, width: 2000 }),
  getHomeZoom: () => homeZoom,
  getMaxZoom: () => maxZoom,
  getZoom: () => zoom,
  pixelFromPoint: ({ x, y }) => ({
    x: ((x - bounds.x) * 1000) / bounds.width,
    y: ((y - bounds.y) * 500) / bounds.height,
  }),
});

/** The rect a `fitBounds` call was made with */
const fittedRect = (viewport) => {
  const [{ height, width, x, y }] = viewport.fitBounds.mock.calls[0];
  return { height, width, x, y };
};

/** The viewport point a `fitBounds` call put at a given container pixel */
const pointAtPixel = (viewport, pixel) => {
  const rect = fittedRect(viewport);
  return { x: rect.x + (pixel.x * rect.width) / 1000, y: rect.y + (pixel.y * rect.height) / 500 };
};

const poiAt = (x, y) => ({
  id: `poi-${x}-${y}`,
  target: { selector: [{ type: 'PointSelector', x, y }], source: 'canvas' },
});

/** A DOMRect-like box */
const box = (left, top, width, height) => ({
  bottom: top + height,
  height,
  left,
  right: left + width,
  top,
  width,
});

/**
 * Builds a Mirador window holding an OSD container at (0, 0) 1000x500px and companion windows
 * at the given boxes, returning the OSD container element.
 */
const osdElementWithOverlays = (overlays) => {
  const windowElement = document.createElement('div');
  windowElement.className = 'mirador-window';
  const element = document.createElement('div');
  element.getBoundingClientRect = () => box(0, 0, 1000, 500);
  windowElement.appendChild(element);
  overlays.forEach(({ position, rect }) => {
    const overlay = document.createElement('aside');
    overlay.className = `mirador-companion-window-${position}`;
    overlay.getBoundingClientRect = () => rect;
    windowElement.appendChild(overlay);
  });
  return element;
};

describe('poiPreviewPlugin viewport helpers', () => {
  let viewport;

  /** Registers the window's OSD viewer */
  const setViewer = (viewer) => OSDReferences.set('window', { current: viewer });

  beforeEach(() => {
    viewport = fakeViewport();
    setViewer({ viewport });
  });

  afterEach(() => {
    OSDReferences.remove('window');
  });

  describe('getPoiPoint', () => {
    it("reads a POI's PointSelector", () => {
      expect(getPoiPoint(poiAt(10, 20))).toEqual({ x: 10, y: 20 });
    });

    it('returns null for annotations without a point', () => {
      expect(getPoiPoint({ id: 'a', target: 'canvas#xywh=0,0,1,1' })).toBeNull();
      expect(getPoiPoint({ id: 'b' })).toBeNull();
    });
  });

  describe('getVisibleMapArea', () => {
    it('is the whole map without companion windows over it', () => {
      expect(getVisibleMapArea({ element: osdElementWithOverlays([]), viewport })).toEqual({
        height: 500,
        width: 1000,
        x: 0,
        y: 0,
      });
    });

    it('leaves out a right-hand panel floating over the map', () => {
      const element = osdElementWithOverlays([{ position: 'right', rect: box(600, 0, 400, 500) }]);
      expect(getVisibleMapArea({ element, viewport })).toEqual({ height: 500, width: 600, x: 0, y: 0 });
    });

    it('leaves out a panel on the left (the right-hand panel in a right-to-left layout)', () => {
      const element = osdElementWithOverlays([{ position: 'right', rect: box(0, 0, 400, 500) }]);
      expect(getVisibleMapArea({ element, viewport })).toEqual({ height: 500, width: 600, x: 400, y: 0 });
    });

    it('leaves out a bottom sheet', () => {
      const element = osdElementWithOverlays([{ position: 'bottom', rect: box(0, 300, 1000, 200) }]);
      expect(getVisibleMapArea({ element, viewport })).toEqual({ height: 300, width: 1000, x: 0, y: 0 });
    });

    it('ignores companion windows laid out next to the map', () => {
      const element = osdElementWithOverlays([{ position: 'right', rect: box(1000, 0, 400, 500) }]);
      expect(getVisibleMapArea({ element, viewport })).toEqual({ height: 500, width: 1000, x: 0, y: 0 });
    });

    it('falls back to the whole map when the panel covers nearly all of it', () => {
      const element = osdElementWithOverlays([{ position: 'bottom', rect: box(0, 50, 1000, 450) }]);
      expect(getVisibleMapArea({ element, viewport })).toEqual({ height: 500, width: 1000, x: 0, y: 0 });
    });
  });

  describe('focusMapOnPoint', () => {
    it('centres the point and zooms in relative to the home zoom', () => {
      focusMapOnPoint('window', { x: 10, y: 20 });

      // zoom 4 => a quarter of a viewport unit per 1000px container... i.e. 1/4000 unit per pixel
      expect(fittedRect(viewport).width).toBeCloseTo(0.25);
      expect(pointAtPixel(viewport, { x: 500, y: 250 })).toEqual({ x: 10, y: 20 });
    });

    it('centres the point in the part of the map a preview panel leaves visible', () => {
      setViewer({
        element: osdElementWithOverlays([{ position: 'right', rect: box(600, 0, 400, 500) }]),
        viewport,
      });

      focusMapOnPoint('window', { x: 10, y: 20 });

      expect(pointAtPixel(viewport, { x: 300, y: 250 })).toEqual({ x: 10, y: 20 });
    });

    it('never zooms out a user who is already closer in', () => {
      viewport = fakeViewport({ zoom: 10 });
      setViewer({ viewport });

      focusMapOnPoint('window', { x: 10, y: 20 });

      expect(fittedRect(viewport).width).toBeCloseTo(0.1);
    });

    it('caps the zoom at the max zoom', () => {
      viewport = fakeViewport({ maxZoom: 2 });
      setViewer({ viewport });

      focusMapOnPoint('window', { x: 10, y: 20 });

      expect(fittedRect(viewport).width).toBeCloseTo(0.5);
    });

    it('does nothing when the window has no viewer yet', () => {
      expect(() => focusMapOnPoint('unknown', { x: 1, y: 1 })).not.toThrow();
    });
  });

  describe('ensurePointVisible', () => {
    beforeEach(() => {
      setViewer({
        element: osdElementWithOverlays([{ position: 'right', rect: box(600, 0, 400, 500) }]),
        viewport,
      });
    });

    it('leaves the map alone when the point is in view', () => {
      ensurePointVisible('window', { x: 300, y: 250 });

      expect(viewport.fitBounds).not.toHaveBeenCalled();
    });

    it('brings a point hidden behind the preview panel into view, keeping the zoom', () => {
      ensurePointVisible('window', { x: 800, y: 250 });

      expect(fittedRect(viewport).width).toBeCloseTo(1);
      expect(pointAtPixel(viewport, { x: 300, y: 250 })).toEqual({ x: 800, y: 250 });
    });

    it('treats a point right at the edge of the visible map as hidden', () => {
      ensurePointVisible('window', { x: 590, y: 250 });

      expect(viewport.fitBounds).toHaveBeenCalled();
    });
  });

  describe('fitMapToPoints', () => {
    it("fits the stops' bounding box plus padding", () => {
      viewport = fakeViewport({ zoom: 0.001 });
      setViewer({ viewport });

      fitMapToPoints('window', [
        { x: 100, y: 100 },
        { x: 600, y: 300 },
      ]);

      // 500x200 box, padded by 20% of its size (x) and by the 5%-of-home floor (y: 50 > 40):
      // 700x300 into a 1000x500 map - its width decides the scale, centred on (350, 200)
      expect(fittedRect(viewport)).toEqual({ height: 350, width: 700, x: 0, y: 25 });
    });

    it('fits the stops into the part of the map a preview panel leaves visible', () => {
      setViewer({
        element: osdElementWithOverlays([{ position: 'right', rect: box(600, 0, 400, 500) }]),
        viewport,
      });

      fitMapToPoints('window', [
        { x: 100, y: 100 },
        { x: 600, y: 300 },
      ]);

      // 700 units into 600px, centred on the visible area's middle (300, 250)
      expect(pointAtPixel(viewport, { x: 300, y: 250 }).x).toBeCloseTo(350);
      expect(pointAtPixel(viewport, { x: 0, y: 250 }).x).toBeCloseTo(0);
    });

    it('focuses a single stop instead of fitting a zero-size box', () => {
      fitMapToPoints('window', [{ x: 5, y: 6 }]);

      expect(pointAtPixel(viewport, { x: 500, y: 250 })).toEqual({ x: 5, y: 6 });
    });

    it('does nothing without stops', () => {
      fitMapToPoints('window', []);

      expect(viewport.fitBounds).not.toHaveBeenCalled();
    });
  });
});

describe('getPreviewAnnotationId', () => {
  const exists = (id) => ['journey', 'poi'].includes(id);

  it('previews a journey stop through its journey', () => {
    expect(getPreviewAnnotationId({ 'dbf:journey': { id: 'journey', order: 0 }, 'dbf:kind': 'POI', id: 'poi' }, exists)).toBe(
      'journey',
    );
  });

  it('previews a standalone POI, or a journey, as itself', () => {
    expect(getPreviewAnnotationId({ 'dbf:kind': 'POI', id: 'poi' }, exists)).toBe('poi');
    expect(getPreviewAnnotationId({ 'dbf:kind': 'Journey', id: 'journey' }, exists)).toBe('journey');
  });

  it('previews a stop as itself when its journey is not on the canvas', () => {
    expect(getPreviewAnnotationId({ 'dbf:journey': { id: 'gone', order: 0 }, 'dbf:kind': 'POI', id: 'poi' }, exists)).toBe('poi');
  });
});
