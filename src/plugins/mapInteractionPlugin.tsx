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
import { registerTourStepper } from './sitePanelState';
import { getTourPois, type OrderedAnnotation } from './tourOrder';

// Map "tour" interactions for MapViewer's rendering mode (issue #434): stepping through the
// map's POIs one at a time - each step selects the POI, opens its preview (its journey's, with
// it selected, for a journey stop) and focuses the map on it. On a touch screen a quick
// horizontal swipe steps - towards the next POI like turning a page (swiping left, or right in a
// right-to-left layout) - while a slower drag still pans the map; the mobile sheet's swipe steps
// through `registerTourStepper`. The mouse wheel zooms the map, as in plain OpenSeadragon: the
// tour follows the wheel only in the side panel (scrollSelect.ts), not over the map (#504).
// Only for the public viewer: the Strapi editor has no tour, so this isn't part of
// poiPreviewPlugins, and MapViewer registers it on its own.

export type TourStep = { poiId: string; previewId: string; point: { x: number; y: number } };

// The map's POIs in tour order (tourOrder.ts), as steps: POIs without a pin to focus on are
// skipped.
export const getTourSteps = (items: OrderedAnnotation[]): TourStep[] => {
  const ids = new Set(items.map((item) => item.id));
  return getTourPois(items)
    .flatMap((poi) => {
      const point = getPoiPoint(poi);
      return point ? [{ point, poiId: poi.id, previewId: getPreviewAnnotationId(poi, (id) => ids.has(id)) }] : [];
    });
};

// The step a tour step leads to from the selected annotation: the first POI when none of the
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
// OpenSeadragon viewer, it takes over that viewer's touch-swipe handling. An `add`
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
    // The current touch gesture: how far it has dragged, and whether a second finger made it a pinch.
    let touchTravel = { x: 0, y: 0 };
    let isPinch = false;

    // Selects the next (1) or previous (-1) POI of the tour, opens its preview and focuses on it.
    // Stepping only selects, so it never opens a nested map (only pressing a pin or card does).
    const goToStep = (direction: 1 | -1) => {
      const state = latest.current;
      const step = getNextTourStep(getTourSteps(annotationPagesItems(state.annotationPages)), state.selectedAnnotationId, direction);
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

    const unregisterStepper = registerTourStepper(windowId, goToStep);

    const handlers: [string, OsdHandler][] = [
      ['canvas-press', onCanvasPress],
      ['canvas-drag', onCanvasDrag],
      ['canvas-pinch', onCanvasPinch],
      ['canvas-drag-end', onCanvasDragEnd],
    ];
    handlers.forEach(([name, handler]) => viewer.addHandler(name, handler));
    return () => {
      unregisterStepper();
      handlers.forEach(([name, handler]) => viewer.removeHandler(name, handler));
    };
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
