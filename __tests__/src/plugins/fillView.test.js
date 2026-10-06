import { fillViewBounds } from '../../../src/plugins/fillView.ts';

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
});
