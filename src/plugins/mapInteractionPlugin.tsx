import { useEffect, useRef, type ComponentType } from 'react';
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
  preventDefaultAction?: boolean;
  scroll: number;
};
type OsdViewerLike = {
  addHandler: (name: 'canvas-scroll', handler: (event: CanvasScrollEvent) => void) => void;
  removeHandler: (name: 'canvas-scroll', handler: (event: CanvasScrollEvent) => void) => void;
};

interface AnnotationsOverlayTourWrapperProps {
  TargetComponent: ComponentType<Record<string, unknown>>;
  targetProps: { viewer?: OsdViewerLike | null; windowId: string; [key: string]: unknown };
  addCompanionWindow: typeof addCompanionWindow;
  annotationPages?: Parameters<typeof annotationPagesItems>[0];
  existingPreviewCompanionWindowId?: string;
  selectAnnotation: typeof selectAnnotation;
  selectedAnnotationId?: string;
  updateCompanionWindow: typeof updateCompanionWindow;
}

// Wraps AnnotationsOverlay, which receives the window's OpenSeadragon viewer, to take over its
// wheel handling.
const AnnotationsOverlayTourWrapper = ({
  TargetComponent,
  targetProps,
  addCompanionWindow: dispatchAddCompanionWindow,
  annotationPages,
  existingPreviewCompanionWindowId,
  selectAnnotation: dispatchSelectAnnotation,
  selectedAnnotationId,
  updateCompanionWindow: dispatchUpdateCompanionWindow,
}: AnnotationsOverlayTourWrapperProps) => {
  const { viewer, windowId } = targetProps;
  const previewPosition = usePreviewPosition();

  // The handler is registered once per viewer and reads the latest state through this ref.
  const latest = useRef({
    annotationPages,
    dispatchAddCompanionWindow,
    dispatchSelectAnnotation,
    existingPreviewCompanionWindowId,
    dispatchUpdateCompanionWindow,
    previewPosition,
    selectedAnnotationId,
  });
  latest.current = {
    annotationPages,
    dispatchAddCompanionWindow,
    dispatchSelectAnnotation,
    existingPreviewCompanionWindowId,
    dispatchUpdateCompanionWindow,
    previewPosition,
    selectedAnnotationId,
  };

  useEffect(() => {
    if (!viewer) return undefined;
    let lastWheelAt = -Infinity;

    const onCanvasScroll = (event: CanvasScrollEvent) => {
      // Browsers report a trackpad pinch as a ctrl+wheel: leave it zooming the map.
      if (event.originalEvent?.ctrlKey) return;
      // eslint-disable-next-line no-param-reassign -- OpenSeadragon's own opt-out of its scroll-to-zoom
      event.preventDefaultAction = true;

      const now = Date.now();
      const isNewGesture = now - lastWheelAt > WHEEL_GESTURE_GAP_MS;
      lastWheelAt = now;
      if (!isNewGesture) return;

      const state = latest.current;
      // OpenSeadragon's `scroll` is positive for a wheel pushed away (up): back through the tour.
      const step = getNextTourStep(
        getTourSteps(annotationPagesItems(state.annotationPages)),
        state.selectedAnnotationId,
        event.scroll > 0 ? -1 : 1
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

    viewer.addHandler('canvas-scroll', onCanvasScroll);
    return () => viewer.removeHandler('canvas-scroll', onCanvasScroll);
  }, [viewer, windowId]);

  return <TargetComponent {...targetProps} />;
};

const mapInteractionPlugin = {
  target: 'AnnotationsOverlay',
  mode: 'wrap',
  component: AnnotationsOverlayTourWrapper,
  mapStateToProps: (state: unknown, { windowId }: { windowId: string }) => ({
    annotationPages: getCanvasAnnotationPages(state, windowId),
    existingPreviewCompanionWindowId: getPreviewCompanionWindowId(state, windowId),
    selectedAnnotationId: getSelectedAnnotationId(state, { windowId }) as string | undefined,
  }),
  mapDispatchToProps: { addCompanionWindow, selectAnnotation, updateCompanionWindow },
};

export const mapInteractionPlugins = [mapInteractionPlugin];
