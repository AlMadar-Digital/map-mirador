import { render } from '@testing-library/react';
import {
  getNextTourStep,
  getSwipeDirection,
  getTourSteps,
  mapInteractionPlugins,
} from '../../../src/plugins/mapInteractionPlugin.tsx';

const at = (x, y) => ({ selector: [{ type: 'PointSelector', x, y }], source: 'canvas' });

const journey = (id, order) => ({ 'dbf:kind': 'Journey', 'dbf:order': order, id });
const poi = (id, { order = null, journeyId = null, stop = null, x = 1, y = 1 } = {}) => ({
  'dbf:journey': journeyId ? { id: journeyId, order: stop } : null,
  'dbf:kind': 'POI',
  'dbf:order': order,
  id,
  target: at(x, y),
});

const items = [
  poi('late', { order: 5 }),
  journey('nile', 1),
  poi('aswan', { journeyId: 'nile', stop: 1 }),
  poi('cairo', { journeyId: 'nile', stop: 0 }),
  poi('first', { order: 0 }),
  poi('unordered'),
  { ...poi('nowhere', { order: 2 }), target: undefined },
];

describe('getTourSteps', () => {
  it('orders top-level items by dbf:order and unrolls a journey into its stops', () => {
    expect(getTourSteps(items).map(({ poiId }) => poiId)).toEqual(['first', 'cairo', 'aswan', 'late', 'unordered']);
  });

  it('previews a journey stop through its journey, a standalone POI as itself', () => {
    const steps = getTourSteps(items);
    expect(steps.find(({ poiId }) => poiId === 'cairo').previewId).toBe('nile');
    expect(steps.find(({ poiId }) => poiId === 'first').previewId).toBe('first');
  });

  it("carries each POI's pin position", () => {
    expect(getTourSteps([poi('p', { x: 10, y: 20 })])[0].point).toEqual({ x: 10, y: 20 });
  });

  it('treats a stop whose journey is not on the canvas as a standalone POI', () => {
    const steps = getTourSteps([poi('orphan', { journeyId: 'gone', order: 0, stop: 0 })]);
    expect(steps).toEqual([expect.objectContaining({ poiId: 'orphan', previewId: 'orphan' })]);
  });
});

describe('getNextTourStep', () => {
  const steps = getTourSteps(items);

  it('starts on the first POI whichever way the wheel turns', () => {
    expect(getNextTourStep(steps, undefined, 1).poiId).toBe('first');
    expect(getNextTourStep(steps, undefined, -1).poiId).toBe('first');
    expect(getNextTourStep(steps, 'nile', 1).poiId).toBe('first');
  });

  it('moves to the next or previous POI', () => {
    expect(getNextTourStep(steps, 'cairo', 1).poiId).toBe('aswan');
    expect(getNextTourStep(steps, 'cairo', -1).poiId).toBe('first');
  });

  it('stops at either end', () => {
    expect(getNextTourStep(steps, 'unordered', 1)).toBeNull();
    expect(getNextTourStep(steps, 'first', -1)).toBeNull();
  });

  it('has nowhere to go on a map without POIs', () => {
    expect(getNextTourStep([], undefined, 1)).toBeNull();
  });
});

describe('getSwipeDirection', () => {
  const LEFT = Math.PI;
  const RIGHT = 0;
  const fast = 1000;

  it('goes to the next POI on a quick swipe left, the previous one on a swipe right', () => {
    expect(getSwipeDirection({ direction: LEFT, speed: fast }, { x: -120, y: 10 }, false)).toBe(1);
    expect(getSwipeDirection({ direction: RIGHT, speed: fast }, { x: 120, y: -10 }, false)).toBe(-1);
  });

  it('mirrors the directions in a right-to-left layout', () => {
    expect(getSwipeDirection({ direction: RIGHT, speed: fast }, { x: 120, y: 0 }, true)).toBe(1);
    expect(getSwipeDirection({ direction: LEFT, speed: fast }, { x: -120, y: 0 }, true)).toBe(-1);
  });

  it('leaves slow or short drags panning the map', () => {
    expect(getSwipeDirection({ direction: LEFT, speed: 200 }, { x: -120, y: 0 }, false)).toBeNull();
    expect(getSwipeDirection({ direction: LEFT, speed: fast }, { x: -20, y: 0 }, false)).toBeNull();
  });

  it('ignores mostly vertical drags', () => {
    expect(getSwipeDirection({ direction: LEFT, speed: fast }, { x: -100, y: 120 }, false)).toBeNull();
    expect(getSwipeDirection({ direction: Math.PI / 2, speed: fast }, { x: -120, y: 0 }, false)).toBeNull();
  });

  it('ignores a drag that flicks back the other way at the end', () => {
    expect(getSwipeDirection({ direction: RIGHT, speed: fast }, { x: -120, y: 0 }, false)).toBeNull();
  });
});

describe('mapInteractionPlugin wheel handling', () => {
  const [{ component: Wrapper }] = mapInteractionPlugins;
  let handler;
  let props;
  let now;

  /** A stand-in OSD viewer keeping hold of its canvas-scroll handler */
  let handlers;
  const viewer = {
    addHandler: (name, fn) => {
      handlers[name] = fn;
      if (name === 'canvas-scroll') handler = fn;
    },
    removeHandler: vi.fn(),
    viewport: {
      applyConstraints: vi.fn(),
      pointFromPixel: ({ x, y }) => ({ viewportX: x, viewportY: y }),
      zoomBy: vi.fn(),
    },
    zoomPerScroll: 2,
  };

  /**
   * Fires a canvas-scroll event, returning it. `amount` is OpenSeadragon's scroll direction
   * (positive for a wheel pushed away); the DOM event's deltaY is its opposite unless given.
   */
  const scroll = (amount, { ctrlKey = false, shiftKey = false, deltaX = 0, deltaY = -amount, after = 1000 } = {}) => {
    now += after;
    const event = {
      originalEvent: { ctrlKey, deltaX, deltaY, shiftKey },
      position: { x: 10, y: 20 },
      preventDefaultAction: false,
      scroll: amount,
    };
    handler(event);
    return event;
  };

  beforeEach(() => {
    handlers = {};
    now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    props = {
      addCompanionWindow: vi.fn(),
      annotationPages: { page: { json: { items } } },
      selectAnnotation: vi.fn(),
      TargetComponent: () => null,
      targetProps: { viewer, windowId: 'window' },
      updateCompanionWindow: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('opens the first POI on the first scroll instead of zooming', () => {
    render(<Wrapper {...props} />);

    const event = scroll(-1);

    expect(event.preventDefaultAction).toBe(true);
    expect(props.selectAnnotation).toHaveBeenCalledWith('window', 'first');
    expect(props.addCompanionWindow).toHaveBeenCalledWith(
      'window',
      expect.objectContaining({ annotationid: 'first', content: 'mapsPoiPreview' }),
    );
  });

  it("moves on through a journey's stops in its own preview", () => {
    render(<Wrapper {...props} existingPreviewCompanionWindowId="cw" selectedAnnotationId="first" />);

    scroll(-1);

    expect(props.selectAnnotation).toHaveBeenCalledWith('window', 'cairo');
    expect(props.updateCompanionWindow).toHaveBeenCalledWith('window', 'cw', expect.objectContaining({ annotationid: 'nile' }));
  });

  it('scrolling up goes back', () => {
    render(<Wrapper {...props} existingPreviewCompanionWindowId="cw" selectedAnnotationId="aswan" />);

    scroll(1);

    expect(props.selectAnnotation).toHaveBeenCalledWith('window', 'cairo');
  });

  it('moves one step per wheel gesture', () => {
    render(<Wrapper {...props} />);

    scroll(-1);
    scroll(-1, { after: 50 });
    scroll(-1, { after: 50 });

    expect(props.selectAnnotation).toHaveBeenCalledTimes(1);
  });

  it('leaves a pinch (ctrl+wheel) zooming the map', () => {
    render(<Wrapper {...props} />);

    const event = scroll(-1, { ctrlKey: true });

    expect(event.preventDefaultAction).toBe(false);
    expect(props.selectAnnotation).not.toHaveBeenCalled();
  });

  it('zooms around the pointer on shift+wheel instead of touring', () => {
    render(<Wrapper {...props} />);

    const event = scroll(1, { shiftKey: true });
    scroll(-1, { after: 10, shiftKey: true });

    expect(event.preventDefaultAction).toBe(true);
    expect(viewer.viewport.zoomBy).toHaveBeenNthCalledWith(1, 2, { viewportX: 10, viewportY: 20 });
    expect(viewer.viewport.zoomBy).toHaveBeenNthCalledWith(2, 0.5, expect.anything());
    expect(props.selectAnnotation).not.toHaveBeenCalled();
  });

  it('zooms on shift+wheel when the browser turns it into a horizontal scroll', () => {
    render(<Wrapper {...props} />);

    scroll(0, { deltaX: -100, deltaY: 0, shiftKey: true });

    expect(viewer.viewport.zoomBy).toHaveBeenCalledWith(2, expect.anything());
  });

  it('ignores a sideways-only swipe', () => {
    render(<Wrapper {...props} />);

    const event = scroll(0, { deltaX: 100, deltaY: 0 });

    expect(event.preventDefaultAction).toBe(true);
    expect(props.selectAnnotation).not.toHaveBeenCalled();
  });

  describe('touch swipes', () => {
    /** Plays a one-finger touch gesture dragging by `moves`, ending at `speed` towards `direction` */
    const swipe = (moves, { direction, speed = 1000, pinch = false, pointerType = 'touch' }) => {
      handlers['canvas-press']({ pointerType });
      moves.forEach(([x, y]) => handlers['canvas-drag']({ delta: { x, y }, pointerType }));
      if (pinch) handlers['canvas-pinch']({});
      const event = { direction, pointerType, preventDefaultAction: false, speed };
      handlers['canvas-drag-end'](event);
      return event;
    };

    it('opens the next POI on a quick swipe left, without the flick carrying the map on', () => {
      render(<Wrapper {...props} existingPreviewCompanionWindowId="cw" selectedAnnotationId="cairo" />);

      const event = swipe(
        [
          [-40, 0],
          [-40, 5],
          [-40, 0],
        ],
        { direction: Math.PI },
      );

      expect(event.preventDefaultAction).toBe(true);
      expect(props.selectAnnotation).toHaveBeenCalledWith('window', 'aswan');
    });

    it('goes back on a swipe right', () => {
      render(<Wrapper {...props} existingPreviewCompanionWindowId="cw" selectedAnnotationId="cairo" />);

      swipe(
        [
          [60, 0],
          [60, 0],
        ],
        { direction: 0 },
      );

      expect(props.selectAnnotation).toHaveBeenCalledWith('window', 'first');
    });

    it('leaves a slow drag panning the map', () => {
      render(<Wrapper {...props} />);

      const event = swipe(
        [
          [-60, 0],
          [-60, 0],
        ],
        { direction: Math.PI, speed: 100 },
      );

      expect(event.preventDefaultAction).toBe(false);
      expect(props.selectAnnotation).not.toHaveBeenCalled();
    });

    it('ignores a pinch', () => {
      render(<Wrapper {...props} />);

      swipe(
        [
          [-60, 0],
          [-60, 0],
        ],
        { direction: Math.PI, pinch: true },
      );

      expect(props.selectAnnotation).not.toHaveBeenCalled();
    });

    it('ignores mouse drags', () => {
      render(<Wrapper {...props} />);

      swipe(
        [
          [-60, 0],
          [-60, 0],
        ],
        { direction: Math.PI, pointerType: 'mouse' },
      );

      expect(props.selectAnnotation).not.toHaveBeenCalled();
    });

    it('measures each gesture from its own start', () => {
      render(<Wrapper {...props} />);

      swipe([[-30, 0]], { direction: Math.PI, speed: 100 });
      swipe([[-30, 0]], { direction: Math.PI });

      expect(props.selectAnnotation).not.toHaveBeenCalled();
    });
  });
});
