import { useEffect, type RefObject } from 'react';
import { SHEET_SNAPS, setSheetSnap, stepTour, type SheetSnap } from './sitePanelState';
import { rowEdges } from './scrollSelect';

// The site preset's bottom sheet gestures (TL-09, D6): dragging its header resizes it and lets
// go onto the nearest height (or the next one in a flick's direction); a sideways swipe across
// it turns the tour to the next or previous POI. Over a journey's carousel the carousel scrolls
// itself (scrollSelect.ts picks the stop), and the swipe only turns the tour past either end. The host styles the heights; while dragging,
// the live height is the `--dbf-map-sheet-height` custom property on the Mirador window, which
// the host's sheet and map tools both read.

// The open height, MapViewer's `defaultSidebarPanelHeight`.
const HALF_SHEET_HEIGHT = 310;
// The minimised sheet's peek: its handle and the top of its label (Figma "Overview 7").
export const PEEK_SHEET_HEIGHT = 38;
// The map left above a full sheet (Figma "Overview 10").
const FULL_SHEET_TOP_GAP = 168;
// A release faster than this (px/ms) moves on to the next height in its direction.
const FLICK_SPEED = 0.4;
// A press moves this far (px) before it counts as a drag, along its main axis.
const AXIS_LOCK_DISTANCE = 8;
// A sideways swipe: at least this far (px) and fast (px/ms), within this angle of horizontal.
const SWIPE_MIN_DISTANCE = 50;
const SWIPE_MIN_SPEED = 0.5;
const SWIPE_MAX_ANGLE = Math.PI / 6;

export type SnapHeights = Record<SheetSnap, number>;

/** The sheet's heights in a window `containerHeight` px tall. */
export const snapHeights = (containerHeight: number): SnapHeights => {
  const full = Math.max(PEEK_SHEET_HEIGHT, containerHeight - FULL_SHEET_TOP_GAP);
  return { collapsed: PEEK_SHEET_HEIGHT, full, half: Math.min(HALF_SHEET_HEIGHT, full) };
};

/**
 * The height a released drag settles on: the nearest one, or after a flick (`velocity` in px/ms,
 * positive when the sheet grows) the next one in that direction.
 */
export const pickSnap = (height: number, velocity: number, heights: SnapHeights): SheetSnap => {
  const bySize = [...SHEET_SNAPS].sort((a, b) => heights[a] - heights[b]);
  if (velocity > FLICK_SPEED) return bySize.find((snap) => heights[snap] > height + 1) ?? bySize[bySize.length - 1];
  if (velocity < -FLICK_SPEED) return [...bySize].reverse().find((snap) => heights[snap] < height - 1) ?? bySize[0];
  return bySize.reduce((best, snap) => (Math.abs(heights[snap] - height) < Math.abs(heights[best] - height) ? snap : best));
};

/** Which way a sideways swipe turns the tour: 1 for the next POI, -1 for the previous, null for none. */
export const swipeDirection = (dx: number, dy: number, duration: number, isRtl: boolean): 1 | -1 | null => {
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE || Math.abs(dx) / Math.max(1, duration) < SWIPE_MIN_SPEED) return null;
  if (Math.abs(dy) > Math.abs(dx) * Math.tan(SWIPE_MAX_ANGLE)) return null;
  const towardsNext = isRtl ? dx > 0 : dx < 0;
  return towardsNext ? 1 : -1;
};

type Press = {
  axis: 'x' | 'y' | null;
  // Over a sideways-scrolling list: whether it could scroll no further either way.
  row: { atEnd: boolean; atStart: boolean } | null;
  fromHeader: boolean;
  height: number;
  lastTime: number;
  lastY: number;
  pointerId: number;
  time: number;
  velocity: number;
  x: number;
  y: number;
};

interface UseSheetGesturesOptions {
  bodyRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  headerRef: RefObject<HTMLElement | null>;
  isRtl: boolean;
  windowId: string;
}

export const useSheetGestures = ({ bodyRef, enabled, headerRef, isRtl, windowId }: UseSheetGesturesOptions) => {
  useEffect(() => {
    const body = bodyRef.current;
    const header = headerRef.current;
    if (!enabled || !body || !header) return undefined;
    const sheet = () => body.closest('aside');
    const mapWindow = () => body.closest<HTMLElement>('.mirador-window');
    const heights = () => snapHeights(mapWindow()?.clientHeight ?? window.innerHeight);

    let press: Press | null = null;
    // A press over the carousel that the browser took over to scroll it natively: its pointer
    // events stop there (pointercancel), so it ends with its touch instead.
    let rowSwipe: Press | null = null;
    let swallowClick = false;

    const endDrag = () => {
      delete body.dataset.dragging;
      mapWindow()?.style.removeProperty('--dbf-map-sheet-height');
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      const target = event.target as HTMLElement;
      const fromHeader = header.contains(target);
      // The close button stays a plain button; on the body, only touch swipes count.
      if (target.closest('.dbf-map-panel__close') || (!fromHeader && event.pointerType === 'mouse')) return;
      const height = sheet()?.getBoundingClientRect().height;
      if (!height) return;
      const row = target.closest<HTMLElement>('.dbf-map-panel__list');
      press = {
        axis: null,
        row: row && row.scrollWidth > row.clientWidth + 1 ? rowEdges(row) : null,
        fromHeader,
        height,
        lastTime: event.timeStamp,
        lastY: event.clientY,
        pointerId: event.pointerId,
        time: event.timeStamp,
        velocity: 0,
        x: event.clientX,
        y: event.clientY,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!press.axis) {
        if (Math.hypot(dx, dy) < AXIS_LOCK_DISTANCE) return;
        press.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
        // A vertical drag on the content scrolls it.
        if (press.axis === 'y' && !press.fromHeader) {
          press = null;
          return;
        }
        if (press.axis === 'y') {
          header.setPointerCapture?.(event.pointerId);
          body.dataset.dragging = 'true';
        }
      }
      if (press.axis !== 'y') return;
      event.preventDefault();
      const elapsed = Math.max(1, event.timeStamp - press.lastTime);
      press.velocity = (press.lastY - event.clientY) / elapsed;
      press.lastY = event.clientY;
      press.lastTime = event.timeStamp;
      const { collapsed, full } = heights();
      const height = Math.min(full, Math.max(collapsed, press.height - dy));
      mapWindow()?.style.setProperty('--dbf-map-sheet-height', `${height}px`);
    };

    // A sideways swipe turns the tour - over the carousel, only past its first or last card.
    const endSwipe = (ended: Press, x: number, y: number, time: number) => {
      const direction = swipeDirection(x - ended.x, y - ended.y, time - ended.time, isRtl);
      if (!direction) return;
      if (ended.row && !(direction === 1 ? ended.row.atEnd : ended.row.atStart)) return;
      stepTour(windowId, direction);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId) return;
      const ended = press;
      press = null;
      if (ended.axis === 'y') {
        const height = sheet()?.getBoundingClientRect().height ?? ended.height;
        endDrag();
        setSheetSnap(windowId, pickSnap(height, ended.velocity, heights()));
        // The click that follows a drag that started on the handle isn't a tap.
        swallowClick = true;
        setTimeout(() => {
          swallowClick = false;
        }, 0);
        return;
      }
      if (ended.axis === 'x') endSwipe(ended, event.clientX, event.clientY, event.timeStamp);
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (!press || event.pointerId !== press.pointerId) return;
      if (press.axis === 'y') endDrag();
      if (press.row && press.axis !== 'y') rowSwipe = press;
      press = null;
    };

    const onTouchEnd = (event: TouchEvent) => {
      const ended = rowSwipe;
      rowSwipe = null;
      const touch = event.changedTouches[0];
      if (ended && touch) endSwipe(ended, touch.clientX, touch.clientY, event.timeStamp);
    };

    const onClickCapture = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    body.addEventListener('pointerdown', onPointerDown);
    header.addEventListener('click', onClickCapture, true);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      endDrag();
      body.removeEventListener('pointerdown', onPointerDown);
      header.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [bodyRef, enabled, headerRef, isRtl, windowId]);
};
