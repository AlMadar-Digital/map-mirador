import { fillViewBounds, halfwayViewBounds, halfwayZoom, normalizeInitialView } from '../../../src/plugins/fillView.ts';

const image = { height: 1295, width: 1800, x: 0, y: 0 };
const inView = (view, container, { x, y }) => {
  const scale = container.x / view.width;
  const px = (x - view.x) * scale;
  const py = (y - view.y) * scale;
  // the pin: 50px tall above its point, 50px wide around it
  return px - 25 >= 0 && px + 25 <= container.x && py - 50 >= 0 && py <= container.y;
};

describe('fillViewBounds', () => {
  it('fills the view when the POIs allow it, cropping the image rather than banding it', () => {
    const container = { x: 1440, y: 900 };
    const view = fillViewBounds(image, container, [{ x: 900, y: 600 }]);

    expect(view.width).toBeCloseTo(1800);
    expect(view.height).toBeLessThan(image.height);
    expect(view.y).toBeGreaterThanOrEqual(0);
    expect(view.y + view.height).toBeLessThanOrEqual(image.height);
  });

  it('zooms out only as far as keeps every POI and its pin in view', () => {
    const container = { x: 390, y: 844 };
    const points = [
      { x: 396, y: 389 },
      { x: 1548, y: 492 },
    ];
    const view = fillViewBounds(image, container, points);

    points.forEach((point) => expect(inView(view, container, point)).toBe(true));
    expect(view.width).toBeLessThan(image.width);
  });

  it('never zooms out past the whole image', () => {
    const view = fillViewBounds(image, { x: 390, y: 844 }, [
      { x: 0, y: 0 },
      { x: 1800, y: 1295 },
    ]);

    expect(view.width / 390).toBeCloseTo(Math.max(1800 / 390, 1295 / 844));
  });
});

describe('normalizeInitialView', () => {
  it('keeps a view it knows and fills for anything else', () => {
    expect(normalizeInitialView('halfway')).toBe('halfway');
    expect(normalizeInitialView('firstPoi')).toBe('firstPoi');
    ['x', undefined, null, 2].forEach((value) => expect(normalizeInitialView(value)).toBe('fill'));
  });
});

describe('halfwayViewBounds', () => {
  const container = { x: 1000, y: 800 };
  // Inverts the bounds back to where they show a point, and at what zoom.
  const view = (bounds, point) => ({
    pixel: { x: (point.x - bounds.x) / (bounds.width / container.x), y: (point.y - bounds.y) / (bounds.height / container.y) },
    zoom: 1 / bounds.width,
  });

  it('zooms halfway and moves the POI halfway to where the focus would centre it (#504)', () => {
    const point = { x: 0.9, y: 0.2 };
    const bounds = halfwayViewBounds({
      container,
      fillPixel: { x: 960, y: 60 },
      fillZoom: 1,
      focusPixel: { x: 300, y: 400 },
      focusZoom: 4,
      point,
    });
    const { pixel, zoom } = view(bounds, point);

    expect(zoom).toBeCloseTo(2);
    expect(pixel.x).toBeCloseTo(630);
    expect(pixel.y).toBeCloseTo(230);
    expect(bounds.height / bounds.width).toBeCloseTo(container.y / container.x);
  });

  it('keeps a POI near the edge in view, where zooming around the centre would lose it', () => {
    const point = { x: 0.98, y: 0.5 };
    const fill = { fillPixel: { x: 980, y: 400 }, fillZoom: 1, focusPixel: { x: 500, y: 400 }, focusZoom: 4 };
    const { pixel } = view(halfwayViewBounds({ container, point, ...fill }), point);
    expect(pixel.x).toBeGreaterThan(0);
    expect(pixel.x).toBeLessThan(container.x);

    // Zoomed 2x around the centre instead, the same POI lands at 500 + (980 - 500) * 2 = 1460px.
    expect(500 + (980 - 500) * 2).toBeGreaterThan(container.x);
  });

  it('stays put when the map is already at the focus', () => {
    const point = { x: 0.5, y: 0.4 };
    const at = { x: 500, y: 400 };
    const { pixel, zoom } = view(
      halfwayViewBounds({ container, fillPixel: at, fillZoom: 3, focusPixel: at, focusZoom: 3, point }),
      point,
    );
    expect(zoom).toBeCloseTo(3);
    expect(pixel.x).toBeCloseTo(500);
    expect(pixel.y).toBeCloseTo(400);
  });
});

describe('halfwayZoom', () => {
  it('is as many zoom steps from one end as from the other', () => {
    expect(halfwayZoom(1, 4)).toBe(2);
    expect(halfwayZoom(2, 2)).toBe(2);
  });
});

describe('useFillView', () => {
  // A stand-in for the OpenSeadragon viewer: one image, a viewport that remembers its view.
  const fakeViewer = () => {
    const handlers = {};
    const view = { center: { x: 0, y: 0 }, zoom: 1 };
    const item = { getBounds: () => image };
    return {
      addOnceHandler: (name, handler) => {
        handlers[name] = handler;
      },
      handlers,
      removeHandler: vi.fn(),
      view,
      viewport: {
        fitBounds: vi.fn((rect) => {
          view.center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          view.zoom = 1 / rect.width;
        }),
        getCenter: () => view.center,
        getContainerSize: () => ({ x: 1440, y: 900 }),
        getZoom: () => view.zoom,
      },
      world: { addHandler: vi.fn(), getItemAt: () => item, removeHandler: vi.fn() },
    };
  };

  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('fills straight away when the image has finished loading before it mounts', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useFillView } = await import('../../../src/plugins/fillView.ts');
    const viewer = fakeViewer();
    const item = { getBounds: () => image, getFullyLoaded: () => true };
    viewer.world.getItemAt = () => item;

    renderHook(() => useFillView({ enabled: true, points: [], viewer, windowId: 'fill-loaded' }));

    expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(1);
    expect(viewer.handlers['tile-loaded']).toBeUndefined();
  });

  it('takes in POIs that arrive after the first fit, unless the visitor has moved the map', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useFillView } = await import('../../../src/plugins/fillView.ts');
    const viewer = fakeViewer();
    const props = { enabled: true, points: [], viewer, windowId: 'fill-1' };
    const { rerender } = renderHook((p) => useFillView(p), { initialProps: props });

    viewer.handlers['tile-loaded']();
    expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(1);

    // The annotations load afterwards: the view takes the new POIs in.
    rerender({
      ...props,
      points: [
        { x: 60, y: 60 },
        { x: 1750, y: 1250 },
      ],
    });
    expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(2);

    // Once the visitor has moved the map, later POIs leave it where it is.
    viewer.view.center = { x: 100, y: 100 };
    rerender({
      ...props,
      points: [
        { x: 60, y: 60 },
        { x: 1750, y: 1250 },
        { x: 900, y: 10 },
      ],
    });
    expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(2);
  });

  describe('initialView (#504)', () => {
    const pois = [
      { x: 60, y: 60 },
      { x: 1750, y: 1250 },
    ];
    const first = { x: 900, y: 600 };

    const open = async (options) => {
      const { renderHook } = await import('@testing-library/react');
      const { useFillView } = await import('../../../src/plugins/fillView.ts');
      const viewer = fakeViewer();
      const focusOnPoint = vi.fn();
      const halfwayToPoint = vi.fn();
      const storeViewport = vi.fn();
      const props = { enabled: true, focusOnPoint, halfwayToPoint, storeViewport, viewer, ...options };
      const hook = renderHook((p) => useFillView(p), { initialProps: props });
      viewer.handlers['tile-loaded']();
      return { focusOnPoint, halfwayToPoint, hook, props, storeViewport, viewer };
    };

    it('stays filled by default', async () => {
      const { focusOnPoint, halfwayToPoint, storeViewport, viewer } = await open({
        firstPoint: first,
        points: pois,
        windowId: 'iv-fill',
      });

      expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(1);
      expect(storeViewport).toHaveBeenCalledTimes(1);
      expect(focusOnPoint).not.toHaveBeenCalled();
      expect(halfwayToPoint).not.toHaveBeenCalled();
    });

    it('focuses on the first POI after filling, without selecting it', async () => {
      const { focusOnPoint, storeViewport, viewer } = await open({
        firstPoint: first,
        initialView: 'firstPoi',
        points: pois,
        windowId: 'iv-first',
      });

      expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(1);
      expect(focusOnPoint).toHaveBeenCalledWith(first);
      // Mirador stores where the zoom ends; storing the fill would pull the map back to it.
      expect(storeViewport).not.toHaveBeenCalled();
    });

    it('moves halfway from the fill towards the first POI focus', async () => {
      const { focusOnPoint, halfwayToPoint, storeViewport, viewer } = await open({
        firstPoint: first,
        initialView: 'halfway',
        points: pois,
        windowId: 'iv-half',
      });

      expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(1);
      expect(halfwayToPoint).toHaveBeenCalledWith(first);
      expect(focusOnPoint).not.toHaveBeenCalled();
      expect(storeViewport).not.toHaveBeenCalled();
    });

    it('waits for the POIs before zooming, and leaves a map the visitor has moved', async () => {
      const { focusOnPoint, hook, props, viewer } = await open({
        firstPoint: null,
        initialView: 'firstPoi',
        points: [],
        windowId: 'iv-late',
      });
      expect(focusOnPoint).not.toHaveBeenCalled();

      hook.rerender({ ...props, firstPoint: first, points: pois });
      expect(focusOnPoint).toHaveBeenCalledTimes(1);

      viewer.view.center = { x: 1, y: 1 };
      hook.rerender({ ...props, firstPoint: first, points: [...pois, { x: 10, y: 10 }] });
      expect(focusOnPoint).toHaveBeenCalledTimes(1);
    });

    it('fills a map without POIs whatever the host asked', async () => {
      const { focusOnPoint, halfwayToPoint, viewer } = await open({
        firstPoint: null,
        initialView: 'halfway',
        points: [],
        windowId: 'iv-none',
      });

      expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(1);
      expect(halfwayToPoint).not.toHaveBeenCalled();
      expect(focusOnPoint).not.toHaveBeenCalled();
    });
  });
});
