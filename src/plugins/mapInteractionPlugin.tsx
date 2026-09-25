import { useEffect, useRef } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  addCompanionWindow,
  getSelectedAnnotationId,
  selectAnnotation,
  updateCompanionWindow,
  // Relative, not `from 'dbf-mirador'` - see poiPreviewPlugin.tsx.
} from '../index';
import {
  annotationPagesItems,
  focusMapOnPoint,
  getCanvasAnnotationPages,
  getPoiPoint,
  getPreviewAnnotationId,
  getPreviewCompanionWindowId,
  openPreview,
  usePreviewPosition,
} from './poiPreviewPlugin';

// Map "tour" interactions for MapViewer's rendering mode (issue #434): the mouse wheel steps
// through the map's POIs one at a time instead of zooming - each step selects the POI, opens
// its preview (its journey's, with it selected, for a journey stop) and focuses the map on it.
// Shift+wheel zooms instead, as does a trackpad pinch. On a touch screen, a quick horizontal
// swipe does the same as a wheel notch - towards the next POI like turning a page (swiping
// left, or right in a right-to-left layout) - while a slower drag still pans the map.
// Only for the public viewer: in the Strapi editor the wheel has to keep zooming, so this
// isn't part of poiPreviewPlugins, and MapViewer registers it on its own.

type OrderedAnnotation = {
  id: string;
  'dbf:kind'?: 'POI' | 'Journey';
  'dbf:journey'?: { id: string; order: number } | null;
  'dbf:order'?: number | null;
  target?: unknown;
};

export type TourStep = { poiId: string; previewId: string; point: { x: number; y: number } };

// A missing order sorts after every explicit one; ties break on id for a stable order - the
// same rule as mirador-annotation-editor's annotationListGrouping.js, so the tour follows the
// editor's list.
const compareByOrder = (
  a: { id: string; order?: number | null },
  b: { id: string; order?: number | null }
) => {
  if (a.order === b.order) return a.id.localeCompare(b.id);
  if (a.order === null || a.order === undefined) return 1;
  if (b.order === null || b.order === undefined) return -1;
  return a.order - b.order;
};

// The map's POIs in tour order: journeys and standalone POIs by their `dbf:order`, a journey
// unrolled into its stops (by `dbf:journey.order`) where it falls. A journey isn't a step of its
// own - its first stop is. POIs without a pin to focus on are skipped.
export const getTourSteps = (items: OrderedAnnotation[]): TourStep[] => {
  const ids = new Set(items.map((item) => item.id));
  const pois = items.filter((item) => item['dbf:kind'] === 'POI');
  const stopsOf = (journeyId: string) =>
    pois
      .filter((poi) => poi['dbf:journey']?.id === journeyId)
      .sort((a, b) =>
        compareByOrder({ id: a.id, order: a['dbf:journey']?.order }, { id: b.id, order: b['dbf:journey']?.order })
      );

  const topLevel = items
    .filter(
      (item) =>
        item['dbf:kind'] === 'Journey' ||
        // A stop whose journey isn't on this canvas stands on its own.
        (item['dbf:kind'] === 'POI' && !(item['dbf:journey']?.id && ids.has(item['dbf:journey'].id)))
    )
    .sort((a, b) => compareByOrder({ id: a.id, order: a['dbf:order'] }, { id: b.id, order: b['dbf:order'] }));

  return topLevel
    .flatMap((item) => (item['dbf:kind'] === 'Journey' ? stopsOf(item.id) : [item]))
    .flatMap((poi) => {
      const point = getPoiPoint(poi);
      return point ? [{ point, poiId: poi.id, previewId: getPreviewAnnotationId(poi, (id) => ids.has(id)) }] : [];
    });
};

// The step a wheel notch leads to from the selected annotation: the first POI when none of the
// tour's is selected yet, otherwise the next (`direction` 1) or previous (-1) one, stopping at
// either end. `null` when there's nowhere to go.
export const getNextTourStep = (
  steps: TourStep[],
  selectedAnnotationId: string | undefined,
  direction: 1 | -1
): TourStep | null => {
  if (steps.length === 0) return null;
  const current = steps.findIndex((step) => step.poiId === selectedAnnotationId);
  if (current === -1) return steps[0];
  const next = Math.min(steps.length - 1, Math.max(0, current + direction));
  return next === current ? null : steps[next];
};

// A trackpad fires a long stream of wheel events per swipe (inertia included), a mouse wheel
// one per notch: a pause this long ends a gesture, and each gesture moves one step.
const WHEEL_GESTURE_GAP_MS = 250;

type CanvasScrollEvent = {
  originalEvent?: WheelEvent;
  position?: { x: number; y: number };
  preventDefaultAction?: boolean;
  scroll: number;
};
type CanvasPressEvent = { pointerType?: string };
type CanvasDragEvent = {
  delta: { x: number; y: number };
  pointerType?: string;
  preventDefaultAction?: boolean;
};
type CanvasDragEndEvent = {
  direction: number;
  pointerType?: string;
  preventDefaultAction?: boolean;
  speed: number;
};
type OsdHandler = (event: never) => void;
type OsdViewerLike = {
  addHandler: (name: string, handler: OsdHandler) => void;
  removeHandler: (name: string, handler: OsdHandler) => void;
  viewport?: {
    applyConstraints: () => void;
    pointFromPixel: (pixel: { x: number; y: number }, current?: boolean) => unknown;
    zoomBy: (factor: number, refPoint?: unknown) => void;
  };
  zoomPerScroll?: number;
};

// A touch drag counts as a swipe - a tour step rather than a pan - when it ends at least this
// fast (px/s), having moved at least SWIPE_MIN_DISTANCE px, mostly sideways (within
// SWIPE_MAX_ANGLE of horizontal, both at the end of the gesture and overall).
const SWIPE_MIN_SPEED = 500;
const SWIPE_MIN_DISTANCE = 50;
const SWIPE_MAX_ANGLE = Math.PI / 6;

// Which way a touch gesture turns the tour: 1 for the next POI, -1 for the previous one, `null`
// when it isn't a swipe. `direction` is OpenSeadragon's angle at the end of the drag
// (counterclockwise from the positive x axis), `travel` the drag's overall movement.
export const getSwipeDirection = (
  { direction, speed }: { direction: number; speed: number },
  travel: { x: number; y: number },
  isRtl: boolean
): 1 | -1 | null => {
  if (speed < SWIPE_MIN_SPEED || Math.abs(travel.x) < SWIPE_MIN_DISTANCE) return null;
  if (Math.abs(travel.y) > Math.abs(travel.x) * Math.tan(SWIPE_MAX_ANGLE)) return null;
  if (Math.abs(Math.cos(direction)) < Math.cos(SWIPE_MAX_ANGLE)) return null;
  // Its end must go the same way as the drag overall, not flick back at the last moment.
  if (Math.sign(Math.cos(direction)) !== Math.sign(travel.x)) return null;
  const towardsNext = isRtl ? travel.x > 0 : travel.x < 0;
  return towardsNext ? 1 : -1;
};

// OpenSeadragon's own default zoom step per wheel notch, for a viewer that doesn't say.
const DEFAULT_ZOOM_PER_SCROLL = 1.2;

// Shift+wheel zooms around the pointer, the way the wheel alone does in plain OpenSeadragon.
// Done here rather than left to OpenSeadragon, which reads only a wheel event's vertical delta:
// Chrome and Edge (outside macOS) turn a shift+wheel into a horizontal scroll, which
// OpenSeadragon would see as no scroll at all.
const zoomAtPointer = (viewer: OsdViewerLike, event: CanvasScrollEvent) => {
  const { viewport } = viewer;
  const delta = event.originalEvent ? event.originalEvent.deltaY || event.originalEvent.deltaX : -event.scroll;
  if (!viewport || !delta) return;
  const factor = (viewer.zoomPerScroll ?? DEFAULT_ZOOM_PER_SCROLL) ** (delta < 0 ? 1 : -1);
  viewport.zoomBy(factor, event.position ? viewport.pointFromPixel(event.position, true) : undefined);
  viewport.applyConstraints();
};

interface MapTourControllerProps {
  viewer?: OsdViewerLike | null;
  windowId: string;
  addCompanionWindow: typeof addCompanionWindow;
  annotationPages?: Parameters<typeof annotationPagesItems>[0];
  existingPreviewCompanionWindowId?: string;
  selectAnnotation: typeof selectAnnotation;
  selectedAnnotationId?: string;
  updateCompanionWindow: typeof updateCompanionWindow;
}

// Renders nothing: added to OpenSeadragonViewer, which hands its plugins the window's
// OpenSeadragon viewer, it takes over that viewer's wheel and touch-swipe handling. An `add`
// plugin rather than a wrapper of AnnotationsOverlay (which also gets the viewer), because
// Mirador doesn't chain wrappers of one component: each is handed the bare component, so
// poiPreviewPlugins' own AnnotationsOverlay wrapper would keep this one from ever rendering.
const MapTourController = ({
  viewer,
  windowId,
  addCompanionWindow: dispatchAddCompanionWindow,
  annotationPages,
  existingPreviewCompanionWindowId,
  selectAnnotation: dispatchSelectAnnotation,
  selectedAnnotationId,
  updateCompanionWindow: dispatchUpdateCompanionWindow,
}: MapTourControllerProps) => {
  const previewPosition = usePreviewPosition();
  const isRtl = useTheme().direction === 'rtl';

  // The handler is registered once per viewer and reads the latest state through this ref.
  const latest = useRef({
    annotationPages,
    dispatchAddCompanionWindow,
    dispatchSelectAnnotation,
    existingPreviewCompanionWindowId,
    dispatchUpdateCompanionWindow,
    isRtl,
    previewPosition,
    selectedAnnotationId,
  });
  latest.current = {
    annotationPages,
    dispatchAddCompanionWindow,
    dispatchSelectAnnotation,
    existingPreviewCompanionWindowId,
    dispatchUpdateCompanionWindow,
    isRtl,
    previewPosition,
    selectedAnnotationId,
  };

  useEffect(() => {
    if (!viewer) return undefined;
    let lastWheelAt = -Infinity;
    // The current touch gesture: how far it has dragged, and whether a second finger made it a pinch.
    let touchTravel = { x: 0, y: 0 };
    let isPinch = false;

    // Selects the next (1) or previous (-1) POI of the tour, opens its preview and focuses on it.
    const goToStep = (direction: 1 | -1) => {
      const state = latest.current;
      const step = getNextTourStep(
        getTourSteps(annotationPagesItems(state.annotationPages)),
        state.selectedAnnotationId,
        direction
      );
      if (!step) return;

      state.dispatchSelectAnnotation(windowId, step.poiId);
      openPreview(
        { addCompanionWindow: state.dispatchAddCompanionWindow, updateCompanionWindow: state.dispatchUpdateCompanionWindow },
        windowId,
        state.existingPreviewCompanionWindowId,
        step.previewId,
        state.previewPosition
      );
      // Once the preview has rendered, so the focus frames the POI beside it rather than under it.
      requestAnimationFrame(() => requestAnimationFrame(() => focusMapOnPoint(windowId, step.point)));
    };

    const onCanvasScroll = (event: CanvasScrollEvent) => {
      // Browsers report a trackpad pinch as a ctrl+wheel: leave it zooming the map.
      if (event.originalEvent?.ctrlKey) return;
      // eslint-disable-next-line no-param-reassign -- OpenSeadragon's own opt-out of its scroll-to-zoom
      event.preventDefaultAction = true;
      if (event.originalEvent?.shiftKey) {
        zoomAtPointer(viewer, event);
        return;
      }
      // A sideways-only swipe (a trackpad's horizontal scroll) has no direction to tour in.
      if (!event.scroll) return;

      const now = Date.now();
      const isNewGesture = now - lastWheelAt > WHEEL_GESTURE_GAP_MS;
      lastWheelAt = now;
      if (!isNewGesture) return;

      // OpenSeadragon's `scroll` is positive for a wheel pushed away (up): back through the tour.
      goToStep(event.scroll > 0 ? -1 : 1);
    };

    const onCanvasPress = (event: CanvasPressEvent) => {
      if (event.pointerType !== 'touch') return;
      touchTravel = { x: 0, y: 0 };
      isPinch = false;
    };
    const onCanvasDrag = (event: CanvasDragEvent) => {
      if (event.pointerType !== 'touch') return;
      touchTravel = { x: touchTravel.x + event.delta.x, y: touchTravel.y + event.delta.y };
    };
    const onCanvasPinch = () => {
      isPinch = true;
    };
    const onCanvasDragEnd = (event: CanvasDragEndEvent) => {
      if (event.pointerType !== 'touch' || isPinch) return;
      const direction = getSwipeDirection(event, touchTravel, latest.current.isRtl);
      if (!direction) return;
      // No flick momentum carrying the map on: the step's own focus takes over from here.
      // eslint-disable-next-line no-param-reassign -- OpenSeadragon's own opt-out of its flick
      event.preventDefaultAction = true;
      goToStep(direction);
    };

    const handlers: [string, OsdHandler][] = [
      ['canvas-scroll', onCanvasScroll],
      ['canvas-press', onCanvasPress],
      ['canvas-drag', onCanvasDrag],
      ['canvas-pinch', onCanvasPinch],
      ['canvas-drag-end', onCanvasDragEnd],
    ];
    handlers.forEach(([name, handler]) => viewer.addHandler(name, handler));
    return () => handlers.forEach(([name, handler]) => viewer.removeHandler(name, handler));
  }, [viewer, windowId]);

  return null;
};

const mapInteractionPlugin = {
  target: 'OpenSeadragonViewer',
  mode: 'add',
  component: MapTourController,
  mapStateToProps: (state: unknown, { windowId }: { windowId: string }) => ({
    annotationPages: getCanvasAnnotationPages(state, windowId),
    existingPreviewCompanionWindowId: getPreviewCompanionWindowId(state, windowId),
    selectedAnnotationId: getSelectedAnnotationId(state, { windowId }) as string | undefined,
  }),
  mapDispatchToProps: { addCompanionWindow, selectAnnotation, updateCompanionWindow },
};

export const mapInteractionPlugins = [mapInteractionPlugin];
