import { act, renderHook } from '@testing-library/react';
import {
  consumeOpenMinimised,
  notifyPanelClosed,
  openNextMinimised,
  registerPanelCloseHandler,
  MAP_CLICK_DELAY_MS,
  setPanelCollapsed,
  useMapClick,
  useMinimiseOnFirstInteraction,
  usePanelCollapsed,
} from '../../../src/plugins/sitePanelState.ts';

/** A stand-in OpenSeadragon viewer that records its event handlers */
const fakeViewer = () => {
  const handlers = {};
  return {
    addHandler: (name, handler) => {
      handlers[name] = handler;
    },
    fire: (name) => handlers[name]?.(),
    handlers,
    removeHandler: (name) => {
      delete handlers[name];
    },
  };
};

describe('openNextMinimised', () => {
  it("asks a window's next panel, once, to open minimised", () => {
    expect(consumeOpenMinimised('w')).toBe(false);
    openNextMinimised('w');
    expect(consumeOpenMinimised('other')).toBe(false);
    expect(consumeOpenMinimised('w')).toBe(true);
    expect(consumeOpenMinimised('w')).toBe(false);
  });
});

describe('useMinimiseOnFirstInteraction', () => {
  afterEach(() => setPanelCollapsed('window', false));

  it('minimises "Discover the map" on the first interaction, then stops listening', () => {
    const viewer = fakeViewer();
    const { result } = renderHook(() => {
      useMinimiseOnFirstInteraction(viewer, 'window', true, true);
      return usePanelCollapsed('window');
    });

    act(() => viewer.fire('canvas-drag'));

    expect(result.current).toBe(true);
    expect(viewer.handlers).toEqual({});
  });

  it('leaves a POI panel open', () => {
    const viewer = fakeViewer();
    const { result } = renderHook(() => {
      useMinimiseOnFirstInteraction(viewer, 'window', true, false);
      return usePanelCollapsed('window');
    });

    act(() => viewer.fire('canvas-scroll'));

    expect(result.current).toBe(false);
  });

  it('waits for the viewer and does nothing outside the site preset', () => {
    const viewer = fakeViewer();
    const { rerender } = renderHook(({ v, enabled }) => useMinimiseOnFirstInteraction(v, 'window', enabled, true), {
      initialProps: { enabled: true, v: null },
    });
    rerender({ enabled: false, v: viewer });
    expect(viewer.handlers).toEqual({});

    rerender({ enabled: true, v: viewer });
    expect(Object.keys(viewer.handlers)).toEqual(['canvas-drag', 'canvas-scroll', 'canvas-pinch', 'canvas-click']);
  });
});

describe('useMapClick (AlMadar-Digital/platform#481)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reports a click once it is not the first of a double click', () => {
    const onClick = vi.fn();
    const { result } = renderHook(() => useMapClick(fakeViewer(), true, onClick));
    const [onMapClick] = result.current;

    onMapClick();
    vi.advanceTimersByTime(MAP_CLICK_DELAY_MS - 1);
    expect(onClick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('leaves a double click, which zooms the map, alone', () => {
    const viewer = fakeViewer();
    const onClick = vi.fn();
    const { result } = renderHook(() => useMapClick(viewer, true, onClick));
    const [onMapClick] = result.current;

    onMapClick();
    vi.advanceTimersByTime(200);
    onMapClick();
    viewer.fire('canvas-double-click');
    vi.advanceTimersByTime(MAP_CLICK_DELAY_MS * 2);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('gives the same handlers on every render, calling the latest callback', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender, result } = renderHook(({ onClick }) => useMapClick(fakeViewer(), true, onClick), {
      initialProps: { onClick: first },
    });
    const [onMapClick, cancel] = result.current;
    rerender({ onClick: latest });

    expect(result.current[0]).toBe(onMapClick);
    expect(result.current[1]).toBe(cancel);
    onMapClick();
    vi.advanceTimersByTime(MAP_CLICK_DELAY_MS);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it('drops a click the visitor has moved on from: something else is selected or shown by then', () => {
    const onClick = vi.fn();
    const { rerender, result } = renderHook(({ stateKey }) => useMapClick(fakeViewer(), true, onClick, stateKey), {
      initialProps: { stateKey: 'stop-1 journey' },
    });
    const [onMapClick] = result.current;

    // A pin is picked 100ms after the click on the map: the click must not clear that selection.
    onMapClick();
    vi.advanceTimersByTime(100);
    rerender({ stateKey: 'stop-2 journey' });
    vi.advanceTimersByTime(MAP_CLICK_DELAY_MS);
    expect(onClick).not.toHaveBeenCalled();

    // A click made in the new state counts for it.
    onMapClick();
    vi.advanceTimersByTime(MAP_CLICK_DELAY_MS);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('drops a click on request: the pin pressed next is the one selected already', () => {
    const onClick = vi.fn();
    const { result } = renderHook(() => useMapClick(fakeViewer(), true, onClick, 'stop-1 journey'));
    const [onMapClick, cancel] = result.current;

    onMapClick();
    cancel();
    vi.advanceTimersByTime(MAP_CLICK_DELAY_MS);

    expect(onClick).not.toHaveBeenCalled();
  });

  it('forgets a pending click and stops listening when the map goes away', () => {
    const viewer = fakeViewer();
    const onClick = vi.fn();
    const { result, unmount } = renderHook(() => useMapClick(viewer, true, onClick));

    result.current[0]();
    unmount();
    vi.advanceTimersByTime(MAP_CLICK_DELAY_MS);

    expect(onClick).not.toHaveBeenCalled();
    expect(viewer.handlers).toEqual({});
  });
});

describe('registerPanelCloseHandler', () => {
  it("tells a window's map, and only it, that its panel was closed, until it unregisters", () => {
    const onClose = vi.fn();
    const unregister = registerPanelCloseHandler('closing', onClose);

    notifyPanelClosed('another');
    expect(onClose).not.toHaveBeenCalled();
    notifyPanelClosed('closing');
    expect(onClose).toHaveBeenCalledTimes(1);

    unregister();
    notifyPanelClosed('closing');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
