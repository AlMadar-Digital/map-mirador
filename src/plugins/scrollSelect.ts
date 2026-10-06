import { useEffect, useRef, type RefObject } from 'react';

// The site preset's journey list selects the stop the visitor scrolls to (D6, Figma's note on
// 1:6409): on a desktop, the card that comes up to the top of the panel; on a phone, where the
// host lays the cards out side by side, the card swiped into view. Only the visitor's own
// scrolling counts - not the panel scrolling itself to a stop picked on the map - and a stop is
// picked once the scroll settles, so the map isn't dragged through every card on the way.

// How long the list has to be still for a scroll to count as settled (ms).
export const SCROLL_SETTLE_MS = 150;
// On a vertical list, a card is reached once its top passes this far down the visible part of
// the panel (below the host's `scroll-margin-top`).
const REACHED_AT = 0.3;

/**
 * Whether the host lays the list out side by side (the phone carousel) rather than in a column.
 * Only a flex container counts: every element computes `flex-direction: row` by default.
 */
export const isRowLayout = (list: HTMLElement) => {
  const style = getComputedStyle(list);
  return /^(inline-)?flex$/.test(style.display) && style.flexDirection.startsWith('row');
};

/** The scroller's progress along its row, from 0 at its start, whichever way the text runs. */
const rowProgress = (scroller: HTMLElement) => Math.abs(scroller.scrollLeft);

/** Whether a sideways list can scroll no further towards its start or its end. */
export const rowEdges = (scroller: HTMLElement) => {
  const progress = rowProgress(scroller);
  return {
    atEnd: progress >= scroller.scrollWidth - scroller.clientWidth - 1,
    atStart: progress <= 1,
  };
};

/**
 * The card the visitor has scrolled to: in a row, the one nearest the middle; in a column, the
 * last one whose top has come up past the reading line - or the last card once the list is
 * scrolled to its end, however short it is.
 */
export const pickCardInView = (cards: HTMLElement[], scroller: HTMLElement, row: boolean): HTMLElement | null => {
  if (cards.length === 0) return null;
  const area = scroller.getBoundingClientRect();

  if (row) {
    const middle = area.left + area.width / 2;
    const distance = (card: HTMLElement) => {
      const rect = card.getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - middle);
    };
    return cards.reduce((best, card) => (distance(card) < distance(best) ? card : best));
  }

  if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
    return cards[cards.length - 1];
  }
  const margin = parseFloat(getComputedStyle(cards[0]).scrollMarginTop) || 0;
  const line = area.top + margin + (area.height - margin) * REACHED_AT;
  return cards.filter((card) => card.getBoundingClientRect().top <= line).pop() ?? cards[0];
};

// What the visitor does to scroll a list themselves; a scroll with none of these before it is
// the panel moving on its own.
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

interface UseScrollSelectOptions {
  enabled: boolean;
  // Re-reads the layout when it changes (the panel moving between the side and the sheet).
  layout: string;
  // The list of cards, each carrying its POI's id as `data-poi-id`.
  listRef: RefObject<HTMLElement | null>;
  // The vertical scroller a column list sits in.
  getColumnScroller: (list: HTMLElement) => HTMLElement | null;
  onSelect: (poiId: string) => void;
  selectedId?: string | null;
}

export const useScrollSelect = ({
  enabled,
  getColumnScroller,
  layout,
  listRef,
  onSelect,
  selectedId = null,
}: UseScrollSelectOptions) => {
  const onSelectRef = useRef(onSelect);
  const selectedIdRef = useRef(selectedId);
  // Whether the visitor is the one scrolling, and the stop this hook last picked.
  const visitorScrolling = useRef(false);
  const pickedId = useRef<string | null>(null);
  useEffect(() => {
    onSelectRef.current = onSelect;
    selectedIdRef.current = selectedId;
  });

  // A stop picked some other way (its pin, a card, the keyboard) has the panel scroll to it: that
  // scroll isn't the visitor's until they touch the list again.
  useEffect(() => {
    if (selectedId !== pickedId.current) visitorScrolling.current = false;
    pickedId.current = null;
  }, [selectedId]);

  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list) return undefined;
    const row = isRowLayout(list);
    const scroller = row ? list : getColumnScroller(list);
    if (!scroller) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const markVisitor = () => {
      visitorScrolling.current = true;
    };
    const settle = () => {
      if (!visitorScrolling.current) return;
      const cards = Array.from(list.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement && !!child.dataset.poiId
      );
      const id = pickCardInView(cards, scroller, row)?.dataset.poiId;
      if (!id || id === selectedIdRef.current) return;
      pickedId.current = id;
      onSelectRef.current(id);
    };
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(settle, SCROLL_SETTLE_MS);
    };

    USER_SCROLL_EVENTS.forEach((name) => scroller.addEventListener(name, markVisitor, { passive: true }));
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      USER_SCROLL_EVENTS.forEach((name) => scroller.removeEventListener(name, markVisitor));
      scroller.removeEventListener('scroll', onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `getColumnScroller` is a module-level function
  }, [enabled, layout, listRef]);
};
