import { useEffect, useRef } from 'react';
import OpenSeadragon from 'openseadragon';
import { hasPendingParentViewport } from './nestedMapPlugin';

// The site preset opens a map filling the view (Figma's Explore frames) rather than showing the
// whole image with bands around it - but never zoomed so far that a POI starts off-screen, and
// never further out than the whole image. Applied once per opened map, after Mirador's own fit
// (which runs on the first tile, see OpenSeadragonComponent); Back restores the parent's view
// instead.

type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

// Room kept around the outermost POIs, in screen pixels: a pin's own height above its point,
// plus a margin, so no pin is cut by the edge.
const PIN_HEIGHT = 50;
const PIN_HALF_WIDTH = 25;
const EDGE_MARGIN = 24;

/**
 * The view (in image units) that fills a `container` px viewport with an image of `bounds`,
 * zoomed out only as far as needed to keep every point (with room for its pin) in view.
 */
export const fillViewBounds = (bounds: Rect, container: { x: number; y: number }, points: Point[]): Rect => {
  const cover = Math.min(bounds.width / container.x, bounds.height / container.y);
  const contain = Math.max(bounds.width / container.x, bounds.height / container.y);
  if (!(cover > 0) || !(contain > 0)) return bounds;

  let unitsPerPixel = cover;
  let pinBox: Rect | null = null;
  if (points.length > 0) {
    const xs = points.map(({ x }) => x);
    const ys = points.map(({ y }) => y);
    pinBox = { height: Math.max(...ys) - Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), x: Math.min(...xs), y: Math.min(...ys) };
    const roomX = container.x - 2 * (EDGE_MARGIN + PIN_HALF_WIDTH);
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
    centerX = clamp(centerX, pinBox.x + pinBox.width + side - width / 2, pinBox.x - side + width / 2);
    centerY = clamp(centerY, pinBox.y + pinBox.height + margin - height / 2, pinBox.y - margin - pin + height / 2);
  }
  return { height, width, x: centerX - width / 2, y: centerY - height / 2 };
};

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
const filled = new WeakMap<object, { center: Point; count: number; zoom: number }>();

interface UseFillViewOptions {
  enabled: boolean;
  // The POIs' points in viewport (canvas) units.
  points: Point[];
  // Writes the viewport to Mirador's store too, so Mirador keeps it.
  storeViewport?: (windowId: string, viewport: Record<string, unknown>) => void;
  viewer?: Viewer | null;
  windowId: string;
}

export const useFillView = ({ enabled, points, storeViewport, viewer, windowId }: UseFillViewOptions) => {
  const pointsRef = useRef(points);
  useEffect(() => {
    pointsRef.current = points;
  });

  // Fills the view with an image, framing the current POIs.
  const applyFill = (target: Viewer, item: { getBounds: () => Rect }) => {
    const bounds = fillViewBounds(item.getBounds(), target.viewport.getContainerSize(), pointsRef.current);
    target.viewport.fitBounds(new OpenSeadragon.Rect(bounds.x, bounds.y, bounds.width, bounds.height), true);
    const center = target.viewport.getCenter(true);
    const zoom = target.viewport.getZoom(true);
    filled.set(item, { center, count: pointsRef.current.length, zoom });
    storeViewport?.(windowId, { x: center.x, y: center.y, zoom });
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `storeViewport` is a bound action creator
  }, [enabled, viewer, windowId]);

  // The annotations load separately from the image: POIs arriving after the first fit are taken
  // in, unless the visitor has moved the map since.
  const pointsKey = points.map(({ x, y }) => `${x},${y}`).join(';');
  useEffect(() => {
    if (!enabled || !viewer) return;
    const item = viewer.world.getItemAt(0);
    const fit = item ? filled.get(item) : undefined;
    if (!item || !fit || points.length <= fit.count) return;
    const center = viewer.viewport.getCenter(true);
    const zoom = viewer.viewport.getZoom(true);
    const tolerance = item.getBounds().width * 1e-4;
    const unmoved =
      Math.abs(zoom - fit.zoom) <= fit.zoom * 1e-4 && Math.hypot(center.x - fit.center.x, center.y - fit.center.y) <= tolerance;
    if (unmoved) applyFill(viewer, item);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `points` is captured by `pointsKey`
  }, [enabled, pointsKey, viewer]);
};
