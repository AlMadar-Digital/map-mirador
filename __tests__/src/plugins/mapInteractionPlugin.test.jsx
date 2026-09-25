import { render } from '@testing-library/react';
import { getNextTourStep, getTourSteps, mapInteractionPlugins } from '../../../src/plugins/mapInteractionPlugin.tsx';

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

describe('mapInteractionPlugin wheel handling', () => {
  const [{ component: Wrapper }] = mapInteractionPlugins;
  let handler;
  let props;
  let now;

  /** A stand-in OSD viewer keeping hold of its canvas-scroll handler */
  const viewer = {
    addHandler: (name, fn) => {
      handler = fn;
    },
    removeHandler: vi.fn(),
  };

  /** Fires a canvas-scroll event, returning it */
  const scroll = (amount, { ctrlKey = false, after = 1000 } = {}) => {
    now += after;
    const event = { originalEvent: { ctrlKey }, preventDefaultAction: false, scroll: amount };
    handler(event);
    return event;
  };

  beforeEach(() => {
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
});
