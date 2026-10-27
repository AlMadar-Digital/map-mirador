import { useEffect, useRef } from 'react';
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
// it selected, for a journey stop) and focuses the map on it. The mobile sheet's swipe steps
// through `registerTourStepper`. The map itself is left to OpenSeadragon: the mouse wheel zooms
// it, and the tour follows the wheel only in the side panel (scrollSelect.ts), not over the map
// (#504); a touch drag, however quick, only pans it (AlMadar-Digital/platform#532).
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

interface MapTourControllerProps {
  viewer?: unknown;
  windowId: string;
  addCompanionWindow: typeof addCompanionWindow;
  annotationPages?: Parameters<typeof annotationPagesItems>[0];
  existingPreviewCompanionWindowId?: string;
  selectAnnotation: typeof selectAnnotation;
  selectedAnnotationId?: string;
  updateCompanionWindow: typeof updateCompanionWindow;
}

// Renders nothing: added to OpenSeadragonViewer, which hands its plugins the window's
// OpenSeadragon viewer, it registers the tour's stepper once that viewer is there. An `add`
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

  // The stepper is registered once per viewer and reads the latest state through this ref.
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

    return registerTourStepper(windowId, goToStep);
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
