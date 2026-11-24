import { useEffect, useRef } from 'react';
import OpenSeadragon from 'openseadragon';
import { hasPendingParentViewport } from './nestedMapPlugin';

// The site preset opens a map filling the view (Figma's Explore frames) rather than showing the
// whole image with bands around it - but never zoomed so far that a POI starts off-screen, and
// never further out than the whole image. Applied once per opened map, after Mirador's own fit
// (which runs on the first tile, see OpenSeadragonComponent); Back restores the parent's view
// instead.
//
// A panel docked over the side of the map hides what is behind it, so the POIs are framed in the
// part it leaves free (AlMadar-Digital/platform#682): the map opens moved out from under the
// panel, and zoomed out as far as the whole image beside it if the POIs need that.
//
// A host can then have it zoom in from there (MapViewer's `initialView`, #504): onto the first
// POI of the tour, the way the panel focuses on a POI, or halfway there (`halfwayViewBounds`).
// The zoom animates from the fill, and leaves the panel as it is: it doesn't select the POI.

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };
/** The part of the container no side panel covers: where it starts and how wide it is, in px. */
export type FreeSpan = { x: number; width: number };

/** How a map opens: filling the view, then zoomed halfway in towards the first POI, or onto it. */
export const INITIAL_VIEWS = ['fill', 'halfway', 'firstPoi'] as const;
export type InitialView = (typeof INITIAL_VIEWS)[number];

/** A host's `initialView`, or 'fill' for anything it doesn't name. */
export const normalizeInitialView = (value: unknown): InitialView =>
  INITIAL_VIEWS.includes(value as InitialView) ? (value as InitialView) : 'fill';

/**
 * Halfway between two zooms: their geometric mean, as many wheel notches (each a ×1.2) from one as
 * from the other - zoom is multiplicative, so the arithmetic midpoint would lean towards the POI.
 */
export const halfwayZoom = (fromZoom: number, toZoom: number) => Math.sqrt(fromZoom * toZoom);

interface HalfwayViewInput {
  // Container size, in screen pixels.
  container: Point;
  // Where the fill shows the POI, and where a focus on it would put it (the middle of the part of
  // the map no panel covers), both in container pixels.
  fillPixel: Point;
  focusPixel: Point;
  // The fill's zoom and the focus zoom.
  fillZoom: number;
  focusZoom: number;
  // The POI, in viewport (canvas) units.
  point: Point;
}

/**
 * The view (in viewport units) halfway from the fill to a focus on `point`: zoomed in to
 * `halfwayZoom`, with the POI moved halfway from where the fill shows it to where the focus would
 * put it. Both of those are on screen, so the POI is too - zooming around the fill's own centre
 * instead could push a POI near the edge out of view (#504).
 */
export const halfwayViewBounds = ({ container, fillPixel, fillZoom, focusPixel, focusZoom, point }: HalfwayViewInput): Rect => {
  // OpenSeadragon's zoom is the inverse of the viewport's width in viewport units.
  const unitsPerPixel = 1 / (halfwayZoom(fillZoom, focusZoom) * container.x);
  const pixel = { x: (fillPixel.x + focusPixel.x) / 2, y: (fillPixel.y + focusPixel.y) / 2 };
  return {
    height: container.y * unitsPerPixel,
    width: container.x * unitsPerPixel,
    x: point.x - pixel.x * unitsPerPixel,
    y: point.y - pixel.y * unitsPerPixel,
  };
};

// Room kept around the outermost POIs, in screen pixels: a pin's own height above its point,
// plus a margin, so no pin is cut by the edge.
const PIN_HEIGHT = 50;
const PIN_HALF_WIDTH = 25;
const EDGE_MARGIN = 24;

/**
 * The view (in image units) that fills a `container` px viewport with an image of `bounds`,
 * zoomed out only as far as needed to keep every point (with room for its pin) in view - in
 * `free`, the part of the container a side panel leaves uncovered, when there is one.
 */
export const fillViewBounds = (
  bounds: Rect,
  container: { x: number; y: number },
  points: Point[],
  free: FreeSpan | null = null,
): Rect => {
  const span = free && free.width > 0 && free.width < container.x ? free : { width: container.x, x: 0 };
  const cover = Math.min(bounds.width / container.x, bounds.height / container.y);
  // The whole image, beside the panel.
  const contain = Math.max(bounds.width / span.width, bounds.height / container.y);
  if (!(cover > 0) || !(contain > 0)) return bounds;

  let unitsPerPixel = cover;
  let pinBox: Rect | null = null;
  if (points.length > 0) {
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    pinBox = { height: Math.max(...ys) - Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), x: Math.min(...xs), y: Math.min(...ys) };
    const roomX = span.width - 2 * (EDGE_MARGIN + PIN_HALF_WIDTH);
    const roomY = container.y - 2 * EDGE_MARGIN - PIN_HEIGHT;
    if (roomX > 0 && roomY > 0) {
      unitsPerPixel = Math.max(unitsPerPixel, pinBox.width / roomX, pinBox.height / roomY);
    }
  }
  unitsPerPixel = Math.min(unitsPerPixel, contain);

  const width = container.x * unitsPerPixel;
  const height = container.y * unitsPerPixel;
  // Centred on the image, kept on the image where it covers it, then moved to take in the POIs.
  const clamp = (value: number, min: number, max: number) => (min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value)));
  let centerX = clamp(bounds.x + bounds.width / 2, bounds.x + width / 2, bounds.x + bounds.width - width / 2);
  let centerY = clamp(bounds.y + bounds.height / 2, bounds.y + height / 2, bounds.y + bounds.height - height / 2);
  if (pinBox) {
    const margin = EDGE_MARGIN * unitsPerPixel;
    const side = (EDGE_MARGIN + PIN_HALF_WIDTH) * unitsPerPixel;
    const pin = PIN_HEIGHT * unitsPerPixel;
    // What a panel covers at the start and at the end of the container.
    const before = span.x * unitsPerPixel;
    const after = (container.x - span.x - span.width) * unitsPerPixel;
    centerX = clamp(centerX, pinBox.x + pinBox.width + side - width / 2 + after, pinBox.x - side + width / 2 - before);
    centerY = clamp(centerY, pinBox.y + pinBox.height + margin - height / 2, pinBox.y - margin - pin + height / 2);
  }
  return { height, width, x: centerX - width / 2, y: centerY - height / 2 };
};

// Each window's way back to the view its map opened with, for a panel that closes
// (AlMadar-Digital/platform#549).
const openingViews = new Map<string, () => void>();

/** Animates the window's map back to the view it opened with. */
export const returnToOpeningView = (windowId: string) => openingViews.get(windowId)?.();

type Viewer = {
  addOnceHandler: (name: string, handler: () => void) => void;
  removeHandler: (name: string, handler: () => void) => void;
  viewport: {
    fitBounds: (rect: OpenSeadragon.Rect, immediately?: boolean) => void;
    getCenter: (current?: boolean) => Point;
    getContainerSize: () => Point;
    getZoom: (current?: boolean) => number;
  };
  world: {
    addHandler: (name: string, handler: () => void) => void;
    getItemAt: (index: number) => { getBounds: () => Rect; getFullyLoaded?: () => boolean } | undefined;
    removeHandler: (name: string, handler: () => void) => void;
  };
};

// The images already filled, so a map is filled once however it got here - and how each was
// filled: the view it was given and how many POIs it framed, so POIs that arrive after the
// image's first tile can still be taken in while the visitor hasn't moved the map.
const filled = new WeakMap<object, { center: Point; count: number; free: FreeSpan | null; zoom: number }>();

const sameSpan = (a: FreeSpan | null, b: FreeSpan | null) =>
  Math.abs((a?.x ?? 0) - (b?.x ?? 0)) < 1 && Math.abs((a?.width ?? 0) - (b?.width ?? 0)) < 1;

interface UseFillViewOptions {
  enabled: boolean;
  // The first POI of the tour, in viewport (canvas) units, for the halfway and firstPoi views.
  firstPoint?: Point | null;
  // The part of the map no side panel covers, measured when the map is filled
  // (poiPreviewPlugin's getVisibleMapArea); the whole of it when left out.
  freeSpan?: () => FreeSpan | null;
  // Focuses the map on a point the way the panel does (poiPreviewPlugin's focusMapOnPoint).
  focusOnPoint?: (point: Point) => void;
  // Moves the map halfway from the fill to that focus (poiPreviewPlugin's zoomMapHalfwayToPoint).
  halfwayToPoint?: (point: Point) => void;
  // Where the map ends up once it fills the view; 'fill' (stay) unless the host chose otherwise.
  initialView?: InitialView;
  // Changes when the panel that opens with the map does: a panel that arrives after the map was
  // filled is taken into account, unless the visitor has moved the map since. Empty for a panel
  // that shows something the visitor picked, which moves the map itself.
  panelKey?: string;
  // The POIs' points in viewport (canvas) units.
  points: Point[];
  // Writes the viewport to Mirador's store too, so Mirador keeps it.
  storeViewport?: (windowId: string, viewport: Record<string, unknown>) => void;
  viewer?: Viewer | null;
  windowId: string;
}

export const useFillView = ({
  enabled,
  firstPoint = null,
  focusOnPoint,
  freeSpan,
  halfwayToPoint,
  initialView = 'fill',
  panelKey = '',
  points,
  storeViewport,
  viewer,
  windowId,
}: UseFillViewOptions) => {
  // Read when the image's first tile is in, which can be after these last changed.
  const latest = useRef({ firstPoint, focusOnPoint, freeSpan, halfwayToPoint, initialView, points });
  useEffect(() => {
    latest.current = { firstPoint, focusOnPoint, freeSpan, halfwayToPoint, initialView, points };
  });

  // Fills the view with an image, framing the current POIs, then zooms in as the host asked.
  const applyFill = (target: Viewer, item: { getBounds: () => Rect }) => {
    const current = latest.current;
    const free = current.freeSpan?.() ?? null;
    const bounds = fillViewBounds(item.getBounds(), target.viewport.getContainerSize(), current.points, free);
    target.viewport.fitBounds(new OpenSeadragon.Rect(bounds.x, bounds.y, bounds.width, bounds.height), true);
    const center = target.viewport.getCenter(true);
    const zoom = target.viewport.getZoom(true);
    filled.set(item, { center, count: current.points.length, free, zoom });

    // Without a POI yet there is nothing to zoom towards: the fill stands, and is taken up again
    // when the POIs arrive (below).
    if (current.initialView === 'fill' || !current.firstPoint) {
      storeViewport?.(windowId, { x: center.x, y: center.y, zoom });
      return;
    }
    // The zoom animates on from the fill, and Mirador stores where it ends. The fill isn't stored:
    // Mirador moves the viewer back to a stored view that differs from where it is heading.
    if (current.initialView === 'firstPoi') current.focusOnPoint?.(current.firstPoint);
    else current.halfwayToPoint?.(current.firstPoint);
  };

  useEffect(() => {
    if (!enabled || !viewer) return undefined;
    let frame = 0;
    const fill = () => {
      frame = requestAnimationFrame(() => {
        const item = viewer.world.getItemAt(0);
        if (!item || filled.has(item)) return;
        applyFill(viewer, item);
      });
    };
    // A map shown afresh (not a parent restored by Back) fills the view once its first tile is in.
    const onAddItem = () => {
      if (!hasPendingParentViewport(windowId)) viewer.addOnceHandler('tile-loaded', fill);
    };
    viewer.world.addHandler('add-item', onAddItem);
    // Back to the opening view, animated this time: the fill, then the host's zoom on from it,
    // as when the map opened.
    const isAt = (bounds: Rect) => {
      const center = viewer.viewport.getCenter(true);
      const zoom = viewer.viewport.getZoom(true);
      // OpenSeadragon's zoom is the inverse of the viewport's width in viewport units.
      const fillZoom = 1 / bounds.width;
      return (
        Math.abs(zoom - fillZoom) <= fillZoom * 1e-3 &&
        Math.hypot(center.x - (bounds.x + bounds.width / 2), center.y - (bounds.y + bounds.height / 2)) <= bounds.width * 1e-3
      );
    };
    let zoomOn: (() => void) | null = null;
    const reopen = () => {
      const item = viewer.world.getItemAt(0);
      if (!item) return;
      const current = latest.current;
      // The whole view: this runs as the panel closes, while it is still sliding away.
      const bounds = fillViewBounds(item.getBounds(), viewer.viewport.getContainerSize(), current.points);
      if (zoomOn) viewer.removeHandler('animation-finish', zoomOn);
      const point = current.initialView === 'fill' ? null : current.firstPoint;
      zoomOn = () => {
        zoomOn = null;
        // Only from the fill: a visitor who took the map elsewhere on the way keeps it.
        if (!point || !isAt(bounds)) return;
        if (latest.current.initialView === 'firstPoi') latest.current.focusOnPoint?.(point);
        else latest.current.halfwayToPoint?.(point);
      };
      // Already filling the view: no animation is coming to wait for.
      if (isAt(bounds)) {
        zoomOn();
        return;
      }
      if (point) viewer.addOnceHandler('animation-finish', zoomOn);
      else zoomOn = null;
      viewer.viewport.fitBounds(new OpenSeadragon.Rect(bounds.x, bounds.y, bounds.width, bounds.height));
    };
    openingViews.set(windowId, reopen);
    // The map's image may be in already when this mounts - all its tiles even, in which case no
    // `tile-loaded` is coming, so it fills straight away.
    const shown = viewer.world.getItemAt(0);
    if (shown && !hasPendingParentViewport(windowId)) {
      if (shown.getFullyLoaded?.()) fill();
      else viewer.addOnceHandler('tile-loaded', fill);
    }
    return () => {
      cancelAnimationFrame(frame);
      viewer.world.removeHandler('add-item', onAddItem);
      viewer.removeHandler('tile-loaded', fill);
      if (zoomOn) viewer.removeHandler('animation-finish', zoomOn);
      if (openingViews.get(windowId) === reopen) openingViews.delete(windowId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `storeViewport` is a bound action creator
  }, [enabled, viewer, windowId]);

  // The annotations load separately from the image: POIs arriving after the first fit are taken
  // in (and the host's zoom towards the first of them applied), unless the visitor has moved the
  // map since.
  const unmovedSince = (target: Viewer, item: { getBounds: () => Rect }, fit: { center: Point; zoom: number }) => {
    const center = target.viewport.getCenter(true);
    const zoom = target.viewport.getZoom(true);
    const tolerance = item.getBounds().width * 1e-4;
    return Math.abs(zoom - fit.zoom) <= fit.zoom * 1e-4 && Math.hypot(center.x - fit.center.x, center.y - fit.center.y) <= tolerance;
  };
  const pointsKey = points.map(({ x, y }) => `${x},${y}`).join(';');
  useEffect(() => {
    if (!enabled || !viewer) return;
    const item = viewer.world.getItemAt(0);
    const fit = item ? filled.get(item) : undefined;
    if (!item || !fit || points.length <= fit.count) return;
    if (unmovedSince(viewer, item, fit)) applyFill(viewer, item);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `points` is captured by `pointsKey`
  }, [enabled, pointsKey, viewer]);

  // The panel can open after the map was filled: the POIs it would cover are moved out from
  // under it, unless the visitor has moved the map since (AlMadar-Digital/platform#682).
  useEffect(() => {
    if (!enabled || !viewer || !panelKey) return undefined;
    // A frame on, so the panel is laid out where it is measured.
    const frame = requestAnimationFrame(() => {
      const item = viewer.world.getItemAt(0);
      const fit = item ? filled.get(item) : undefined;
      if (!item || !fit || !unmovedSince(viewer, item, fit)) return;
      if (!sameSpan(latest.current.freeSpan?.() ?? null, fit.free)) applyFill(viewer, item);
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `applyFill` reads the latest values through a ref
  }, [enabled, panelKey, viewer]);
};
