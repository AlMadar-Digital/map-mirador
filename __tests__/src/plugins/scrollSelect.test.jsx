import { useRef } from 'react';
import PropTypes from 'prop-types';
import { act, render, screen } from '@testing-library/react';
import {
  pickCardInView,
  pickSnapTarget,
  rowEdges,
  SCROLL_SETTLE_MS,
  useScrollSelect,
} from '../../../src/plugins/scrollSelect.ts';

const rect = (left, top, width, height) => ({
  bottom: top + height,
  height,
  left,
  right: left + width,
  top,
  width,
  x: left,
  y: top,
});

/** An element whose box is `box`, with optional scroll metrics. */
const box = (element, layout, scroll = {}) => {
  // eslint-disable-next-line no-param-reassign -- test double
  element.getBoundingClientRect = () => rect(...layout);
  Object.entries(scroll).forEach(([key, value]) => {
    Object.defineProperty(element, key, { configurable: true, value });
  });
  return element;
};

const card = (id) => {
  const element = document.createElement('article');
  element.dataset.poiId = id;
  return element;
};

describe('pickCardInView', () => {
  it('picks the card nearest the middle of a row', () => {
    const scroller = box(document.createElement('div'), [0, 0, 390, 300]);
    const cards = [box(card('a'), [-300, 0, 326, 200]), box(card('b'), [32, 0, 326, 200]), box(card('c'), [366, 0, 326, 200])];
    expect(pickCardInView(cards, scroller, true).dataset.poiId).toBe('b');
  });

  it('picks the last card in a column whose top has passed the reading line', () => {
    const scroller = box(document.createElement('div'), [0, 0, 480, 900], {
      clientHeight: 900,
      scrollHeight: 3000,
      scrollTop: 400,
    });
    // The line sits 30% of the way down: 270px.
    const cards = [box(card('a'), [0, -500, 400, 400]), box(card('b'), [0, 250, 400, 400]), box(card('c'), [0, 700, 400, 400])];
    expect(pickCardInView(cards, scroller, false).dataset.poiId).toBe('b');
  });

  it('picks the first card before any has reached the line, and the last at the end of the list', () => {
    const top = box(document.createElement('div'), [0, 0, 480, 900], { clientHeight: 900, scrollHeight: 3000, scrollTop: 0 });
    const cards = [box(card('a'), [0, 400, 400, 400]), box(card('b'), [0, 900, 400, 400])];
    expect(pickCardInView(cards, top, false).dataset.poiId).toBe('a');

    const end = box(document.createElement('div'), [0, 0, 480, 900], { clientHeight: 900, scrollHeight: 3000, scrollTop: 2100 });
    expect(pickCardInView(cards, end, false).dataset.poiId).toBe('b');
  });
});

describe('pickSnapTarget', () => {
  // A 900px panel scrolled 1000px down: snap points within 450px of its top are in reach.
  const panel = (scrollTop = 1000) =>
    box(document.createElement('div'), [0, 0, 480, 900], { clientHeight: 900, scrollHeight: 4000, scrollTop });

  it("snaps to the nearest card's top, either way", () => {
    const cards = [box(card('a'), [0, -120, 400, 300]), box(card('b'), [0, 180, 400, 300]), box(card('c'), [0, 480, 400, 300])];
    expect(pickSnapTarget(cards, panel())).toEqual({ card: cards[0], offset: -120 });

    const lower = [box(card('a'), [0, -200, 400, 300]), box(card('b'), [0, 100, 400, 300])];
    expect(pickSnapTarget(lower, panel())).toEqual({ card: lower[1], offset: 100 });
  });

  it("lines the card up below the host's scroll-margin-top", () => {
    // jsdom doesn't compute scroll-margin-top, so the host's style is stood in for.
    const style = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ scrollMarginTop: '60px' });
    const cards = [box(card('a'), [0, 140, 400, 300])];
    expect(pickSnapTarget(cards, panel())).toEqual({ card: cards[0], offset: 80 });
    style.mockRestore();
  });

  it('leaves a card taller than the panel alone once the visitor is reading it', () => {
    const long = box(card('a'), [0, -80, 400, 1400]);
    expect(pickSnapTarget([long, box(card('b'), [0, 1320, 400, 300])], panel())).toBeNull();

    // As its top comes in, it snaps like any other card.
    const entering = box(card('a'), [0, 200, 400, 1400]);
    expect(pickSnapTarget([entering], panel())).toEqual({ card: entering, offset: 200 });
  });

  it('pulls in nothing further than half the panel away', () => {
    expect(pickSnapTarget([box(card('a'), [0, -600, 400, 300]), box(card('b'), [0, 500, 400, 300])], panel())).toBeNull();
  });

  it('snaps back to the start of the list, so the journey heading can be read', () => {
    const cards = [box(card('a'), [0, 300, 400, 300])];
    expect(pickSnapTarget(cards, panel(120))).toEqual({ card: null, offset: -120 });
  });

  it('leaves the start alone once the visitor is reading a long first card', () => {
    // 250px into a 1338px first card, near the top of the list.
    const cards = [box(card('a'), [0, -190, 400, 1338]), box(card('b'), [0, 1148, 400, 300])];
    expect(pickSnapTarget(cards, panel(268))).toBeNull();
  });
});

describe('rowEdges', () => {
  it('tells whether a row can scroll further, either way the text runs', () => {
    const row = (scrollLeft) =>
      box(document.createElement('div'), [0, 0, 390, 300], { clientWidth: 390, scrollLeft, scrollWidth: 1060 });
    expect(rowEdges(row(0))).toEqual({ atEnd: false, atStart: true });
    expect(rowEdges(row(670))).toEqual({ atEnd: true, atStart: false });
    // Right to left, browsers count scrollLeft down from 0.
    expect(rowEdges(row(-670))).toEqual({ atEnd: true, atStart: false });
    expect(rowEdges(row(-300))).toEqual({ atEnd: false, atStart: false });
  });
});

describe('useScrollSelect', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // A column of three cards in a scroller; the second card sits on the reading line.
  const Harness = ({ onSelect, onSnap = undefined, selectedId }) => {
    const listRef = useRef(null);
    useScrollSelect({
      enabled: true,
      // eslint-disable-next-line testing-library/no-node-access -- the harness's own scroller
      getColumnScroller: (list) => list.parentElement,
      layout: 'right',
      listRef,
      onSelect,
      onSnap,
      selectedId,
    });
    return (
      <div data-testid="scroller">
        <div ref={listRef}>
          <article data-poi-id="a" />
          <article data-poi-id="b" />
          <article data-poi-id="c" />
        </div>
      </div>
    );
  };

  Harness.propTypes = {
    onSelect: PropTypes.func.isRequired,
    onSnap: PropTypes.func,
    selectedId: PropTypes.string.isRequired,
  };

  const setup = (selectedId = 'a', onSnap = undefined) => {
    const onSelect = vi.fn();
    const view = render(<Harness onSelect={onSelect} onSnap={onSnap} selectedId={selectedId} />);
    const scroller = screen.getByTestId('scroller');
    box(scroller, [0, 0, 480, 900], { clientHeight: 900, scrollHeight: 3000, scrollTop: 400 });
    // eslint-disable-next-line testing-library/no-node-access -- the cards are plain markup
    const [a, b, c] = scroller.firstElementChild.children;
    box(a, [0, -500, 400, 400]);
    box(b, [0, 250, 400, 400]);
    box(c, [0, 700, 400, 400]);
    return { onSelect, scroller, view };
  };

  it("selects the card the visitor's own scroll settles on", () => {
    const { onSelect, scroller } = setup();
    scroller.dispatchEvent(new Event('wheel'));
    scroller.dispatchEvent(new Event('scroll'));
    expect(onSelect).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SCROLL_SETTLE_MS));
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('ignores the panel scrolling itself, and a selection made elsewhere until the visitor scrolls again', () => {
    const { onSelect, scroller, view } = setup();
    scroller.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(SCROLL_SETTLE_MS));
    expect(onSelect).not.toHaveBeenCalled();

    scroller.dispatchEvent(new Event('touchstart'));
    view.rerender(<Harness onSelect={onSelect} selectedId="c" />);
    scroller.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(SCROLL_SETTLE_MS));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves an already selected card alone', () => {
    const { onSelect, scroller } = setup('b');
    scroller.dispatchEvent(new Event('wheel'));
    scroller.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(SCROLL_SETTLE_MS));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('snaps the card it settles on to the top of the panel, selecting it', () => {
    const onSnap = vi.fn();
    const { onSelect, scroller } = setup('a', onSnap);
    scroller.dispatchEvent(new Event('wheel'));
    scroller.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(SCROLL_SETTLE_MS));

    expect(onSelect).toHaveBeenCalledWith('b');

    expect(onSnap).toHaveBeenCalledWith(scroller.firstElementChild.children[1], 'smooth');
  });

  it('snaps an already selected card back into place too', () => {
    const onSnap = vi.fn();
    const { onSelect, scroller } = setup('b', onSnap);
    scroller.dispatchEvent(new Event('wheel'));
    scroller.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(SCROLL_SETTLE_MS));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onSnap).toHaveBeenCalledTimes(1);
  });

  it("doesn't snap the panel scrolling itself", () => {
    const onSnap = vi.fn();
    const { scroller } = setup('a', onSnap);
    scroller.dispatchEvent(new Event('scroll'));
    act(() => vi.advanceTimersByTime(SCROLL_SETTLE_MS));
    expect(onSnap).not.toHaveBeenCalled();
  });
});
