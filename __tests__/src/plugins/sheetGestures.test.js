import { pickSnap, snapHeights, swipeDirection } from '../../../src/plugins/sheetGestures.ts';
import {
  getSheetSnap,
  registerTourStepper,
  resetSheet,
  setPanelCollapsed,
  setSheetSnap,
  stepTour,
} from '../../../src/plugins/sitePanelState.ts';

const heights = snapHeights(56, 844); // a 390×844 phone

describe('sheet gestures', () => {
  it('has a header, half and full height (full leaves 168px of map)', () => {
    expect(heights).toEqual({ collapsed: 56, full: 676, half: 310 });
    expect(snapHeights(56, 400)).toEqual({ collapsed: 56, full: 232, half: 232 });
  });

  it('settles a slow release on the nearest height', () => {
    expect(pickSnap(560, 0, heights)).toBe('full');
    expect(pickSnap(400, 0, heights)).toBe('half');
    expect(pickSnap(120, 0, heights)).toBe('collapsed');
  });

  it('moves a flick on to the next height in its direction', () => {
    expect(pickSnap(320, 1, heights)).toBe('full');
    expect(pickSnap(300, -1, heights)).toBe('collapsed');
    expect(pickSnap(676, 1, heights)).toBe('full');
    expect(pickSnap(56, -1, heights)).toBe('collapsed');
  });

  it('reads a fast, mostly sideways swipe as a tour step, mirrored right to left', () => {
    expect(swipeDirection(-150, 10, 100, false)).toBe(1);
    expect(swipeDirection(150, 10, 100, false)).toBe(-1);
    expect(swipeDirection(-150, 10, 100, true)).toBe(-1);
    expect(swipeDirection(-30, 0, 20, false)).toBeNull();
    expect(swipeDirection(-150, 120, 100, false)).toBeNull();
    expect(swipeDirection(-150, 0, 1000, false)).toBeNull();
  });
});

describe('sheet snap state', () => {
  afterEach(() => resetSheet('w'));

  it('minimising keeps the open height, so reopening goes back to it', () => {
    setSheetSnap('w', 'full');
    setPanelCollapsed('w', true);
    expect(getSheetSnap('w')).toBe('collapsed');

    setPanelCollapsed('w', false);
    expect(getSheetSnap('w')).toBe('full');
  });

  it('a panel opened afresh starts at half height', () => {
    setSheetSnap('w', 'full');
    resetSheet('w');
    expect(getSheetSnap('w')).toBe('half');
  });

  it('steps the tour through the registered stepper', () => {
    const step = vi.fn();
    const unregister = registerTourStepper('w', step);
    stepTour('w', 1);
    unregister();
    stepTour('w', -1);

    expect(step).toHaveBeenCalledTimes(1);
    expect(step).toHaveBeenCalledWith(1);
  });
});
