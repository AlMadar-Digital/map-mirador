/* eslint-disable testing-library/no-node-access -- the pins live in OpenSeadragon overlays, outside any rendered React tree */
import { renderHook } from '@testing-library/react';
import { pinLabel, requestPinFocus, useSitePins } from '../../../src/plugins/sitePins.ts';
import { consumePanelFocus } from '../../../src/plugins/sitePanelState.ts';

/** A stand-in OpenSeadragon viewer that keeps its overlays in a list */
const fakeViewer = () => {
  const overlays = [];
  return {
    addOverlay: vi.fn(({ element }) => overlays.push(element)),
    overlays,
    removeOverlay: vi.fn((element) => overlays.splice(overlays.indexOf(element), 1)),
    updateOverlay: vi.fn(),
  };
};

const resources = [
  { id: 'a', journeyId: 'j', journeyOrder: 0, pointSelector: { x: 1, y: 2 }, targetId: 'canvas' },
  { id: 'b', journeyId: 'j', journeyOrder: 4, pointSelector: { x: 3, y: 4 }, targetId: 'canvas' },
  { id: 'c', pointSelector: { x: 5, y: 6 }, targetId: 'canvas' },
];
const labels = new Map([
  ['a', 'The table'],
  ['b', 'The crown'],
  ['c', 'Mount'],
]);

describe('useSitePins', () => {
  it('adds a numbered, labelled pin button per POI and marks the selected one', () => {
    const viewer = fakeViewer();
    renderHook(() => useSitePins({ enabled: true, labels, onSelect: vi.fn(), resources, selectedAnnotationId: 'b', viewer }));

    const buttons = viewer.overlays.map((anchor) => anchor.querySelector('button.dbf-map-pin'));
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'The table, stop 1 of 2',
      'The crown, stop 2 of 2',
      'Mount',
    ]);
    expect(buttons.map((button) => button.dataset.number ?? null)).toEqual(['1', '2', null]);
    expect(buttons[1]).toHaveAttribute('data-selected', 'true');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[0]).not.toHaveAttribute('data-selected');
  });

  it('selects a POI from its pin without the click reaching the map', () => {
    const viewer = fakeViewer();
    const onSelect = vi.fn();
    renderHook(() => useSitePins({ enabled: true, labels, onSelect, resources, viewer }));
    const mapClick = vi.fn();
    viewer.overlays[2].addEventListener('click', mapClick);

    viewer.overlays[2].querySelector('button').click();

    expect(onSelect).toHaveBeenCalledWith('c');
    expect(mapClick).not.toHaveBeenCalled();
  });

  it('names a stop "<title>, stop n of m", in English and Arabic', () => {
    expect(pinLabel('The crown', { count: 4, number: 2 }, 'en')).toBe('The crown, stop 2 of 4');
    expect(pinLabel('التاج', { count: 4, number: 2 }, 'ar')).toBe('التاج، المحطة 2 من 4');
    expect(pinLabel('', { count: 4, number: 2 }, 'en')).toBe('stop 2 of 4');
    expect(pinLabel('Mount', null, 'en')).toBe('Mount');
  });

  it('puts the pins in tour order, one tab stop, with the arrow keys moving along them', () => {
    const viewer = fakeViewer();
    const container = document.createElement('div');
    document.body.append(container);
    viewer.addOverlay.mockImplementation(({ element }) => {
      viewer.overlays.push(element);
      container.append(element);
    });
    const onSelect = vi.fn();
    renderHook(() =>
      useSitePins({ enabled: true, labels, onSelect, order: ['c', 'a', 'b'], resources, viewer, windowId: 'keys' }),
    );

    const buttons = [...container.querySelectorAll('button.dbf-map-pin')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Mount',
      'The table, stop 1 of 2',
      'The crown, stop 2 of 2',
    ]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);

    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
    // Arrowing along the pins browses (no nested map opens), unlike pressing one.
    expect(onSelect).toHaveBeenCalledWith('a', { browsing: true });
    expect(buttons[1]).toHaveFocus();

    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'End' }));
    expect(onSelect).toHaveBeenLastCalledWith('b', { browsing: true });

    requestPinFocus('keys', 'c');
    expect(buttons[0]).toHaveFocus();
    container.remove();
  });

  it('asks the panel to take focus when a pin is pressed from the keyboard, not by mouse', () => {
    const viewer = fakeViewer();
    renderHook(() => useSitePins({ enabled: true, labels, onSelect: vi.fn(), resources, viewer, windowId: 'press' }));
    const button = viewer.overlays[0].querySelector('button');

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(consumePanelFocus('press')).toBe(false);

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(consumePanelFocus('press')).toBe(true);
    expect(consumePanelFocus('press')).toBe(false);
  });

  it('removes its pins when it unmounts, and adds none outside the site preset', () => {
    const viewer = fakeViewer();
    const { unmount } = renderHook(() => useSitePins({ enabled: true, labels, onSelect: vi.fn(), resources, viewer }));
    unmount();
    expect(viewer.overlays).toHaveLength(0);

    renderHook(() => useSitePins({ enabled: false, labels, onSelect: vi.fn(), resources, viewer }));
    expect(viewer.addOverlay).toHaveBeenCalledTimes(3);
  });
});
