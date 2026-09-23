import { OSDReferences } from '../../../src/plugins/OSDReferences';
import { fitMapToPoints, focusMapOnPoint, getPoiPoint } from '../../../src/plugins/poiPreviewPlugin.tsx';

/** A stand-in OpenSeadragon viewport recording the calls made on it */
const fakeViewport = ({ zoom = 1, homeZoom = 1, maxZoom = 100 } = {}) => ({
  fitBoundsWithConstraints: vi.fn(),
  getHomeBounds: () => ({ height: 1000, width: 2000 }),
  getHomeZoom: () => homeZoom,
  getMaxZoom: () => maxZoom,
  getZoom: () => zoom,
  panTo: vi.fn(),
  zoomTo: vi.fn(),
});

const poiAt = (x, y) => ({
  id: `poi-${x}-${y}`,
  target: { selector: [{ type: 'PointSelector', x, y }], source: 'canvas' },
});

describe('poiPreviewPlugin viewport helpers', () => {
  let viewport;

  beforeEach(() => {
    viewport = fakeViewport();
    OSDReferences.set('window', { current: { viewport } });
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

  describe('focusMapOnPoint', () => {
    it('pans onto the point and zooms in relative to the home zoom', () => {
      focusMapOnPoint('window', { x: 10, y: 20 });

      expect(viewport.panTo).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 20 }));
      expect(viewport.zoomTo).toHaveBeenCalledWith(4, expect.objectContaining({ x: 10, y: 20 }));
    });

    it('never zooms out a user who is already closer in', () => {
      viewport = fakeViewport({ zoom: 10 });
      OSDReferences.set('window', { current: { viewport } });

      focusMapOnPoint('window', { x: 10, y: 20 });

      expect(viewport.zoomTo).toHaveBeenCalledWith(10, expect.anything());
    });

    it('caps the zoom at the max zoom', () => {
      viewport = fakeViewport({ maxZoom: 2 });
      OSDReferences.set('window', { current: { viewport } });

      focusMapOnPoint('window', { x: 10, y: 20 });

      expect(viewport.zoomTo).toHaveBeenCalledWith(2, expect.anything());
    });

    it('does nothing when the window has no viewer yet', () => {
      expect(() => focusMapOnPoint('unknown', { x: 1, y: 1 })).not.toThrow();
    });
  });

  describe('fitMapToPoints', () => {
    it("fits the stops' bounding box plus padding", () => {
      fitMapToPoints('window', [
        { x: 100, y: 100 },
        { x: 600, y: 300 },
      ]);

      // 500x200 box, padded by 20% of its size (x) and by the 5%-of-home floor (y: 50 > 40)
      expect(viewport.fitBoundsWithConstraints).toHaveBeenCalledWith(
        expect.objectContaining({ height: 300, width: 700, x: 0, y: 50 }),
      );
    });

    it('focuses a single stop instead of fitting a zero-size box', () => {
      fitMapToPoints('window', [{ x: 5, y: 6 }]);

      expect(viewport.fitBoundsWithConstraints).not.toHaveBeenCalled();
      expect(viewport.panTo).toHaveBeenCalled();
    });

    it('does nothing without stops', () => {
      fitMapToPoints('window', []);

      expect(viewport.fitBoundsWithConstraints).not.toHaveBeenCalled();
      expect(viewport.panTo).not.toHaveBeenCalled();
    });
  });
});
