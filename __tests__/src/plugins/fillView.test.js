import { fillViewBounds, halfwayZoom, normalizeInitialView } from '../../../src/plugins/fillView.ts';

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
        getHomeZoom: () => 1 / 1800,
        getMaxZoom: () => 1,
        getZoom: () => view.zoom,
        zoomTo: vi.fn(),
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
      const storeViewport = vi.fn();
      const props = { enabled: true, focusOnPoint, storeViewport, viewer, ...options };
      const hook = renderHook((p) => useFillView(p), { initialProps: props });
      viewer.handlers['tile-loaded']();
      return { focusOnPoint, hook, props, storeViewport, viewer };
    };

    it('stays filled by default', async () => {
      const { focusOnPoint, storeViewport, viewer } = await open({ firstPoint: first, points: pois, windowId: 'iv-fill' });

      expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(1);
      expect(storeViewport).toHaveBeenCalledTimes(1);
      expect(focusOnPoint).not.toHaveBeenCalled();
      expect(viewer.viewport.zoomTo).not.toHaveBeenCalled();
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

    it('zooms halfway in from the fill towards the first POI focus', async () => {
      const { viewer } = await open({ firstPoint: first, initialView: 'halfway', points: pois, windowId: 'iv-half' });

      const fillZoom = viewer.view.zoom;
      const poiZoom = Math.max(fillZoom, (1 / 1800) * 4);
      expect(viewer.viewport.zoomTo).toHaveBeenCalledWith(Math.sqrt(fillZoom * poiZoom));
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
      const { focusOnPoint, viewer } = await open({ firstPoint: null, initialView: 'halfway', points: [], windowId: 'iv-none' });

      expect(viewer.viewport.fitBounds).toHaveBeenCalledTimes(1);
      expect(viewer.viewport.zoomTo).not.toHaveBeenCalled();
      expect(focusOnPoint).not.toHaveBeenCalled();
    });
  });
});
