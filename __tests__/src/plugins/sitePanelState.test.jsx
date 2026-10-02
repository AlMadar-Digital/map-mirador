import { act, renderHook } from '@testing-library/react';
import { setPanelCollapsed, useMinimiseOnFirstInteraction, usePanelCollapsed } from '../../../src/plugins/sitePanelState.ts';

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
