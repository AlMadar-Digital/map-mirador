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
    getItemAt: (index: number) => { getBounds: () => Rect } | undefined;
    removeHandler: (name: string, handler: () => void) => void;
  };
};

// The images already filled, so a map is filled once however it got here.
const filled = new WeakSet<object>();

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

  useEffect(() => {
    if (!enabled || !viewer) return undefined;
    let frame = 0;
    const fill = () => {
      frame = requestAnimationFrame(() => {
        const item = viewer.world.getItemAt(0);
        if (!item || filled.has(item)) return;
        filled.add(item);
        const target = fillViewBounds(item.getBounds(), viewer.viewport.getContainerSize(), pointsRef.current);
        viewer.viewport.fitBounds(new OpenSeadragon.Rect(target.x, target.y, target.width, target.height), true);
        const center = viewer.viewport.getCenter(true);
        storeViewport?.(windowId, { x: center.x, y: center.y, zoom: viewer.viewport.getZoom(true) });
      });
    };
    // A map shown afresh (not a parent restored by Back) fills the view once its first tile is in.
    const onAddItem = () => {
      if (!hasPendingParentViewport(windowId)) viewer.addOnceHandler('tile-loaded', fill);
    };
    viewer.world.addHandler('add-item', onAddItem);
    // The map's image may be in already when this mounts.
    if (viewer.world.getItemAt(0) && !hasPendingParentViewport(windowId)) viewer.addOnceHandler('tile-loaded', fill);
    return () => {
      cancelAnimationFrame(frame);
      viewer.world.removeHandler('add-item', onAddItem);
      viewer.removeHandler('tile-loaded', fill);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `storeViewport` is a bound action creator
  }, [enabled, viewer, windowId]);
};
