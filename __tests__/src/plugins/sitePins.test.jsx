/* eslint-disable testing-library/no-node-access -- the pins live in OpenSeadragon overlays, outside any rendered React tree */
import { renderHook } from '@testing-library/react';
import { useSitePins } from '../../../src/plugins/sitePins.ts';

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
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['1. The table', '2. The crown', 'Mount']);
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

  it('removes its pins when it unmounts, and adds none outside the site preset', () => {
    const viewer = fakeViewer();
    const { unmount } = renderHook(() => useSitePins({ enabled: true, labels, onSelect: vi.fn(), resources, viewer }));
    unmount();
    expect(viewer.overlays).toHaveLength(0);

    renderHook(() => useSitePins({ enabled: false, labels, onSelect: vi.fn(), resources, viewer }));
    expect(viewer.addOverlay).toHaveBeenCalledTimes(3);
  });
});
