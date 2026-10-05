import { useEffect, useRef } from 'react';
import OpenSeadragon from 'openseadragon';
import { journeyStopNumbers } from '../components/AnnotationsOverlay';

// The site preset's map pins: real buttons in OpenSeadragon overlays, one per POI, instead of
// icons drawn on the annotation canvas - so they can be focused and pressed from the keyboard,
// read out by a screen reader, and drawn entirely by the host page's CSS (`.dbf-map-pin`, an
// empty button with `data-number`, `data-selected` and `data-kind`). The overlay is an empty
// anchor on the POI's point; the host's CSS places the pin's tip on it.

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
  // A pin's accessible name: the POI's title, with its stop number when it has one.
  labels: Map<string, string>;
  onSelect: (annotationId: string) => void;
  resources: PinResource[];
  selectedAnnotationId?: string | null;
  viewer?: Viewer | null;
  windowId?: string;
}

// A pin to focus once it exists: Back returns focus to the POI the nested map was opened from.
const pendingPinFocus = new Map<string, string>();

export const requestPinFocus = (windowId: string, annotationId: string) => {
  pendingPinFocus.set(windowId, annotationId);
};

// Events that would otherwise reach OpenSeadragon's canvas under the pin and start a pan or
// count as a click on the map itself.
const SWALLOWED_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick'];

export const useSitePins = ({
  canvasWorld,
  enabled,
  labels,
  onSelect,
  resources,
  selectedAnnotationId,
  viewer,
  windowId,
}: UseSitePinsOptions) => {
  const pinsRef = useRef(new Map<string, { anchor: HTMLElement; button: HTMLButtonElement }>());
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
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
          onSelectRef.current(resource.id);
        });
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
      const title = labels.get(resource.id) ?? '';
      button.setAttribute('aria-label', stopNumber != null ? `${stopNumber}. ${title}` : title);
      seen.add(resource.id);
    });

    pins.forEach((pin, id) => {
      if (seen.has(id)) return;
      viewer.removeOverlay(pin.anchor);
      pins.delete(id);
    });

    const focusId = windowId ? pendingPinFocus.get(windowId) : undefined;
    const focusPin = focusId ? pins.get(focusId) : undefined;
    if (windowId && focusPin) {
      pendingPinFocus.delete(windowId);
      focusPin.button.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `resources` and `labels` are fresh each render; their keys say when they change
  }, [canvasWorld, enabled, labelsKey, resourcesKey, selectedAnnotationId, viewer, windowId]);

  useEffect(() => {
    const pins = pinsRef.current;
    return () => {
      pins.forEach((pin) => viewer?.removeOverlay(pin.anchor));
      pins.clear();
    };
  }, [viewer]);
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
