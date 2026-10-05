import { useEffect, useRef } from 'react';
import OpenSeadragon from 'openseadragon';
import { journeyStopNumbers } from '../components/AnnotationsOverlay';
import { requestPanelFocus } from './sitePanelState';

// The site preset's map pins: real buttons in OpenSeadragon overlays, one per POI, instead of
// icons drawn on the annotation canvas - so they can be focused and pressed from the keyboard,
// read out by a screen reader, and drawn entirely by the host page's CSS (`.dbf-map-pin`, an
// empty button with `data-number`, `data-selected` and `data-kind`). The overlay is an empty
// anchor on the POI's point; the host's CSS places the pin's tip on it.
//
// Keyboard (T-37): the pins sit in the page in tour order and are one tab stop (the selected
// pin, else the first); the arrow keys move between them, selecting as they go; Enter or Space
// opens a pin's panel and moves focus into it.

export type PinResource = {
  id: string;
  journeyId?: string | null;
  journeyOrder?: number | null;
  pointSelector: { x: number; y: number };
  targetId: string;
};

type Viewer = {
  addOverlay: (options: Record<string, unknown>) => void;
  removeOverlay: (element: Element) => void;
  updateOverlay: (element: Element, location: OpenSeadragon.Point, placement: OpenSeadragon.Placement) => void;
};
type CanvasWorld = {
  canvases?: { id: string }[];
  offsetByCanvas?: (canvasId: string) => { x: number; y: number };
};

interface UseSitePinsOptions {
  canvasWorld?: CanvasWorld;
  enabled: boolean;
  // The POIs' titles; a pin is named "<title>, stop n of m" when it is a journey stop.
  labels: Map<string, string>;
  locale?: 'ar' | 'en';
  // POI ids in tour order (tourOrder.ts): the pins' order in the page.
  order?: string[];
  onSelect: (annotationId: string) => void;
  resources: PinResource[];
  selectedAnnotationId?: string | null;
  viewer?: Viewer | null;
  windowId?: string;
}

type Pin = { anchor: HTMLElement; button: HTMLButtonElement };

// Each window's pins, so focus can be put back on one from elsewhere (a closing panel, Back).
const pinsByWindow = new Map<string, Map<string, Pin>>();

// A pin to focus once it exists: Back returns focus to the POI the nested map was opened from.
const pendingPinFocus = new Map<string, string>();

/** Focuses a POI's pin: now if it is on the map, else as soon as it is. */
export const requestPinFocus = (windowId: string, annotationId: string) => {
  const pin = pinsByWindow.get(windowId)?.get(annotationId);
  if (pin && pin.button.isConnected) {
    pin.button.focus({ preventScroll: true });
    return;
  }
  pendingPinFocus.set(windowId, annotationId);
};

/** A pin's accessible name: its title, and its place in the journey when it is a stop. */
export const pinLabel = (title: string, stop: { count: number; number: number } | null, locale: 'ar' | 'en') => {
  if (!stop) return title;
  const where = locale === 'ar' ? `المحطة ${stop.number} من ${stop.count}` : `stop ${stop.number} of ${stop.count}`;
  if (!title) return where;
  return locale === 'ar' ? `${title}، ${where}` : `${title}, ${where}`;
};

const NEXT_KEYS: Record<string, 1 | -1 | 'first' | 'last'> = {
  ArrowDown: 1,
  ArrowUp: -1,
  End: 'last',
  Home: 'first',
};

// Events that would otherwise reach OpenSeadragon's canvas under the pin and start a pan or
// count as a click on the map itself.
const SWALLOWED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick'];

export const useSitePins = ({
  canvasWorld,
  enabled,
  labels,
  locale = 'en',
  onSelect,
  order = [],
  resources,
  selectedAnnotationId,
  viewer,
  windowId,
}: UseSitePinsOptions) => {
  const pinsRef = useRef(new Map<string, Pin>());
  const onSelectRef = useRef(onSelect);
  // The pins in page (tour) order, for the arrow keys.
  const orderedIdsRef = useRef<string[]>([]);
  const lastOrderKeyRef = useRef('');
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // Arrow keys move along the pins, selecting each; left and right follow the reading direction.
  const onPinKeyDown = (event: KeyboardEvent, id: string) => {
    const keys: Record<string, 1 | -1 | 'first' | 'last'> = {
      ...NEXT_KEYS,
      ArrowLeft: locale === 'ar' ? 1 : -1,
      ArrowRight: locale === 'ar' ? -1 : 1,
    };
    const move = keys[event.key];
    if (move === undefined) return;
    event.preventDefault();
    // Not OpenSeadragon's arrow-key panning.
    event.stopPropagation();
    const ids = orderedIdsRef.current;
    const at = ids.indexOf(id);
    let target = at;
    if (move === 'first') target = 0;
    else if (move === 'last') target = ids.length - 1;
    else target = Math.min(ids.length - 1, Math.max(0, at + move));
    const nextId = ids[target];
    if (!nextId || nextId === id) return;
    pinsRef.current.get(nextId)?.button.focus({ preventScroll: true });
    onSelectRef.current(nextId);
  };
  const onPinKeyDownRef = useRef(onPinKeyDown);
  useEffect(() => {
    onPinKeyDownRef.current = onPinKeyDown;
  });

  const resourcesKey = resources
    .map(({ id, journeyId, journeyOrder, pointSelector, targetId }) =>
      [id, pointSelector.x, pointSelector.y, targetId, journeyId ?? '', journeyOrder ?? ''].join(':'))
    .join('|');
  const labelsKey = [...labels].map(([id, label]) => `${id}=${label}`).join('|');

  useEffect(() => {
    const pins = pinsRef.current;
    if (!enabled || !viewer) return;
    const stopNumbers: Map<string, number> = journeyStopNumbers(resources);
    const stopCounts = new Map<string, number>();
    resources.forEach(({ journeyId }) => {
      if (journeyId != null) stopCounts.set(journeyId, (stopCounts.get(journeyId) ?? 0) + 1);
    });
    const seen = new Set<string>();

    resources.forEach((resource) => {
      // Only pins on a canvas the viewer shows: while another map loads (a nested map, Back),
      // the annotations can arrive before their canvas, which has no position yet.
      if (canvasWorld?.canvases && !canvasWorld.canvases.some((canvas) => canvas.id === resource.targetId)) return;
      const offset = canvasWorld?.offsetByCanvas?.(resource.targetId) ?? { x: 0, y: 0 };
      const location = new OpenSeadragon.Point(resource.pointSelector.x + offset.x, resource.pointSelector.y + offset.y);
      let pin = pins.get(resource.id);
      if (pin) {
        viewer.updateOverlay(pin.anchor, location, OpenSeadragon.Placement.TOP_LEFT);
      } else {
        const anchor = document.createElement('div');
        anchor.className = 'dbf-map-pin-anchor';
        // Above the annotation canvas, which OpenSeadragon stacks over its overlays.
        anchor.style.zIndex = '2';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dbf-map-pin';
        button.dataset.kind = 'poi';
        SWALLOWED_EVENTS.forEach((name) => button.addEventListener(name, (event) => event.stopPropagation()));
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          // Enter or Space (a click with no pointer) moves focus into the panel it opens.
          if (event.detail === 0 && windowId) requestPanelFocus(windowId);
          onSelectRef.current(resource.id);
        });
        button.addEventListener('keydown', (event) => onPinKeyDownRef.current(event, resource.id));
        anchor.append(button);
        viewer.addOverlay({
          checkResize: false,
          element: anchor,
          location,
          placement: OpenSeadragon.Placement.TOP_LEFT,
        });
        pin = { anchor, button };
        pins.set(resource.id, pin);
      }

      const { button } = pin;
      const stopNumber = stopNumbers.get(resource.id);
      if (stopNumber != null) button.dataset.number = String(stopNumber);
      else delete button.dataset.number;
      const selected = resource.id === selectedAnnotationId;
      if (selected) button.dataset.selected = 'true';
      else delete button.dataset.selected;
      button.setAttribute('aria-pressed', String(selected));
      const stop =
        stopNumber != null && resource.journeyId != null
          ? { count: stopCounts.get(resource.journeyId) ?? stopNumber, number: stopNumber }
          : null;
      button.setAttribute('aria-label', pinLabel(labels.get(resource.id) ?? '', stop, locale));
      seen.add(resource.id);
    });

    pins.forEach((pin, id) => {
      if (seen.has(id)) return;
      viewer.removeOverlay(pin.anchor);
      pins.delete(id);
    });
    if (windowId) pinsByWindow.set(windowId, pins);

    // Tour order in the page; POIs the tour doesn't know follow in annotation order.
    const ordered = [...order.filter((id) => pins.has(id)), ...[...pins.keys()].filter((id) => !order.includes(id))];
    orderedIdsRef.current = ordered;
    const orderKey = ordered.join('|');
    if (orderKey !== lastOrderKeyRef.current) {
      lastOrderKeyRef.current = orderKey;
      const focused = document.activeElement;
      ordered.forEach((id) => {
        const { anchor } = pins.get(id)!;
        anchor.parentElement?.appendChild(anchor);
      });
      if (focused instanceof HTMLElement && focused.classList.contains('dbf-map-pin')) focused.focus({ preventScroll: true });
    }

    // One tab stop: the selected pin, else the first.
    const tabStop = selectedAnnotationId && pins.has(selectedAnnotationId) ? selectedAnnotationId : ordered[0];
    pins.forEach(({ button }, id) => {
      button.tabIndex = id === tabStop ? 0 : -1;
    });

    const focusId = windowId ? pendingPinFocus.get(windowId) : undefined;
    const focusPin = focusId ? pins.get(focusId) : undefined;
    if (windowId && focusPin) {
      pendingPinFocus.delete(windowId);
      focusPin.button.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `resources`, `labels` and `order` are fresh each render; their keys say when they change
  }, [canvasWorld, enabled, labelsKey, locale, order.join('|'), resourcesKey, selectedAnnotationId, viewer, windowId]);

  useEffect(() => {
    const pins = pinsRef.current;
    return () => {
      pins.forEach((pin) => viewer?.removeOverlay(pin.anchor));
      pins.clear();
      lastOrderKeyRef.current = '';
      if (windowId && pinsByWindow.get(windowId) === pins) pinsByWindow.delete(windowId);
    };
  }, [viewer, windowId]);
};

const cssNumber = (style: CSSStyleDeclaration, name: string) => {
  const value = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : undefined;
};

/**
 * The host page's journey line style, from CSS custom properties on (or inherited by) the
 * viewer: `--dbf-map-line` (colour), `--dbf-map-line-width` and `--dbf-map-line-dash` (screen
 * pixels) and `--dbf-map-line-curve: 1` for a smooth curve through the stops. Null when the
 * host sets none of them, so the line keeps its authored style.
 */
export const readLineStyle = (element?: Element | null) => {
  if (!element) return null;
  const style = getComputedStyle(element);
  const strokeStyle = style.getPropertyValue('--dbf-map-line').trim() || undefined;
  const lineWidth = cssNumber(style, '--dbf-map-line-width');
  const dash = style
    .getPropertyValue('--dbf-map-line-dash')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((length) => Number.isFinite(length) && length >= 0);
  const curve = cssNumber(style, '--dbf-map-line-curve') === 1;
  if (!strokeStyle && lineWidth === undefined && dash.length === 0 && !curve) return null;
  return { curve, lineDash: dash.length > 0 ? dash : undefined, lineWidth, strokeStyle };
};
