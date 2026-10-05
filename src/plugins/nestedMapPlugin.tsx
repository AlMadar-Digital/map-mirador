import { useCallback, useEffect, useRef } from 'react';
import OpenSeadragon from 'openseadragon';
import Button from '@mui/material/Button';
import ArrowBackIcon from '@mui/icons-material/ArrowBackSharp';
import {
  addCompanionWindow,
  getCompanionWindows,
  getConfig,
  getSelectedAnnotationId,
  getViewer,
  getWindow,
  getWindowViewType,
  deselectAnnotation,
  removeCompanionWindow,
  selectAnnotation,
  setWindowViewType,
  updateWindow,
  // Relative, not `from 'dbf-mirador'` - see poiPreviewPlugin.tsx.
} from '../index';
import { NESTED_ORIGIN_ID, POI_PREVIEW_CONTENT_ID } from './previewIds';
import { requestPinFocus } from './sitePins';

// Nested maps (issue #427, following #407): a "Nested Map" point is a POI whose
// `dbf:linkedMap` points at another map. Opening it swaps the map shown in the same Mirador
// window for the linked one - rather than opening a second window next to it, as the editor
// does - and a "Back" button overlaid on the map returns to the map it was opened from.
//
// The way back is a stack of the maps opened so far, kept on the window itself
// (`window.mapHistory`) so it lives and dies with the window, and nested maps can themselves
// open further nested maps.

/**
 * The linked-map reference a Nested Map point carries (see the Strapi maps plugin's
 * annotationConversion.ts): the map's id and, when the annotation server provides it, the URL
 * of its IIIF manifest (`manifestId`).
 */
export type LinkedMap = { id: string; titleEn?: string | null; manifestId?: string | null };

/**
 * Resolves a linked map to the URL of its IIIF manifest, for annotations that don't carry it
 * themselves (`dbf:linkedMap.manifestId`). Given through Mirador's config
 * (`maps.getLinkedMapManifestId`, which MapViewer's `getLinkedMapManifestId` prop sets).
 */
export type LinkedMapManifestResolver = (linkedMap: LinkedMap) => string | null | undefined;

/**
 * Where a nested map was opened from, in the site preset: the POI shown in the panel while the
 * nested map is open, and what Back restores on the parent map (its viewport, selection and
 * preview).
 */
export type NestedOrigin = {
  annotation: unknown;
  position?: 'bottom' | 'right';
  previewAnnotationId?: string;
  selectedAnnotationId?: string;
  viewer?: Record<string, unknown>;
};

type MapHistoryEntry = { manifestId: string; origin?: NestedOrigin };
type MiradorWindow = { id: string; manifestId?: string; mapHistory?: MapHistoryEntry[] };
type Dispatch = (action: unknown) => void;
type GetState = () => unknown;

/**
 * The URL of a linked map's manifest: the one the annotation carries, else the one the host's
 * resolver gives, else null.
 */
export const getLinkedMapManifestId = (state: unknown, linkedMap?: LinkedMap | null): string | null => {
  if (!linkedMap?.id) return null;
  if (linkedMap.manifestId) return linkedMap.manifestId;
  const resolve = (getConfig(state) as { maps?: { getLinkedMapManifestId?: LinkedMapManifestResolver } }).maps
    ?.getLinkedMapManifestId;
  return resolve?.(linkedMap) || null;
};

const getMapHistory = (state: unknown, windowId: string): MapHistoryEntry[] =>
  (getWindow(state, { windowId }) as MiradorWindow | undefined)?.mapHistory ?? [];

/** Where the window's current nested map was opened from, if it was opened from a POI. */
export const getNestedOrigin = (state: unknown, windowId: string): NestedOrigin | null =>
  getMapHistory(state, windowId).at(-1)?.origin ?? null;

// The POI whose selection Back restores must not open its nested map again straight away.
const skipNestedOpen = new Map<string, string>();

/** True, once, for the POI whose selection Back has just restored. */
export const consumeSkipNestedOpen = (windowId: string, annotationId: string): boolean => {
  if (skipNestedOpen.get(windowId) !== annotationId) return false;
  skipNestedOpen.delete(windowId);
  return true;
};

// The viewport Back returns to. Mirador fits a newly shown map to the view once its first tile
// loads (OpenSeadragonComponent), so this is applied right after that.
const pendingViewport = new Map<string, { x?: number; y?: number; zoom?: number }>();

/** True while Back is about to restore the parent map's view (fillView.ts leaves it alone). */
export const hasPendingParentViewport = (windowId: string) => pendingViewport.has(windowId);

type OsdViewer = {
  addOnceHandler: (name: string, handler: () => void) => void;
  removeHandler: (name: string, handler: () => void) => void;
  viewport: { panTo: (point: OpenSeadragon.Point, immediately?: boolean) => void; zoomTo: (zoom: number, refPoint?: null, immediately?: boolean) => void };
  world: {
    addHandler: (name: string, handler: () => void) => void;
    getItemCount: () => number;
    removeHandler: (name: string, handler: () => void) => void;
  };
};

/** Puts the parent map back where it was left, once its image is in the viewer. */
export const useRestoreParentViewport = (
  viewer: OsdViewer | null | undefined,
  windowId: string,
  // Writes the viewport to Mirador's store too, so Mirador keeps it.
  storeViewport?: (windowId: string, viewport: Record<string, unknown>) => void
) => {
  useEffect(() => {
    if (!viewer) return undefined;
    let frame = 0;
    const apply = () => {
      const saved = pendingViewport.get(windowId);
      if (!saved) return;
      // Right after Mirador's own fit, which runs in the same 'tile-loaded' event.
      frame = requestAnimationFrame(() => {
        pendingViewport.delete(windowId);
        if (typeof saved.zoom === 'number') viewer.viewport.zoomTo(saved.zoom, null, true);
        if (typeof saved.x === 'number' && typeof saved.y === 'number') {
          viewer.viewport.panTo(new OpenSeadragon.Point(saved.x, saved.y), true);
        }
        storeViewport?.(windowId, saved);
      });
    };
    // Only once the parent's image is added: right after Back the viewer still holds the
    // nested map's.
    const restore = () => {
      if (pendingViewport.has(windowId)) viewer.addOnceHandler('tile-loaded', apply);
    };
    viewer.world.addHandler('add-item', restore);
    return () => {
      cancelAnimationFrame(frame);
      viewer.world.removeHandler('add-item', restore);
      viewer.removeHandler('tile-loaded', apply);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `storeViewport` is a bound action creator
  }, [viewer, windowId]);
};

const openPreviewOn = (windowId: string, annotationId: string, position: 'bottom' | 'right' = 'right') =>
  addCompanionWindow(windowId, { annotationid: annotationId, content: POI_PREVIEW_CONTENT_ID, position });

/**
 * Shows another manifest in the window, starting it fresh: what was selected or previewed
 * belongs to the map being left, and the viewport is fitted to the new map instead of keeping
 * the old one's position, which means nothing on another image.
 */
const switchWindowMap = (windowId: string, manifestId: string, mapHistory: MapHistoryEntry[]) =>
  (dispatch: Dispatch, getState: GetState) => {
    const state = getState();

    Object.values(getCompanionWindows(state) as Record<string, { id: string; windowId: string; position?: string }>)
      .filter((cw) => cw.windowId === windowId && cw.position !== 'left')
      .forEach((cw) => dispatch(removeCompanionWindow(windowId, cw.id)));

    const selectedAnnotationId = getSelectedAnnotationId(state, { windowId });
    if (selectedAnnotationId) dispatch(deselectAnnotation(windowId, selectedAnnotationId));

    // Setting the view type - to the one already in use - is how Mirador resets a window's
    // viewport (see the viewers reducer); switching the manifest alone would keep it, since a
    // window update always preserves the viewport (see the windows saga's setWindowStartingCanvas).
    dispatch(setWindowViewType(windowId, getWindowViewType(state, { windowId })));
    dispatch(updateWindow(windowId, { canvasId: null, manifestId, mapHistory }));
  };

/**
 * Opens a nested map in place of the window's current map, remembering the way back. Given the
 * POI it was opened from (the site preset), the panel keeps showing that POI, and Back returns
 * to the parent map as it was.
 */
export const openNestedMap =
  (windowId: string, manifestId: string, origin?: Omit<NestedOrigin, 'viewer'>) =>
  (dispatch: Dispatch, getState: GetState) => {
    const state = getState();
    const currentManifestId = (getWindow(state, { windowId }) as MiradorWindow | undefined)?.manifestId;
    if (!currentManifestId || currentManifestId === manifestId) return;

    const entry: MapHistoryEntry = { manifestId: currentManifestId };
    if (origin) {
      entry.origin = { ...origin, viewer: getViewer(state, { windowId }) as Record<string, unknown> | undefined };
    }
    dispatch(switchWindowMap(windowId, manifestId, [...getMapHistory(state, windowId), entry]));
    if (origin?.annotation) dispatch(openPreviewOn(windowId, NESTED_ORIGIN_ID, origin.position));
  };

/** Goes back to the map the current nested map was opened from, as it was left. */
export const backToParentMap = (windowId: string) => (dispatch: Dispatch, getState: GetState) => {
  const mapHistory = getMapHistory(getState(), windowId);
  const parent = mapHistory[mapHistory.length - 1];
  if (!parent) return;

  dispatch(switchWindowMap(windowId, parent.manifestId, mapHistory.slice(0, -1)));
  const { origin } = parent;
  if (!origin) return;
  if (origin.viewer) pendingViewport.set(windowId, origin.viewer as { x?: number; y?: number; zoom?: number });
  if (origin.selectedAnnotationId) {
    skipNestedOpen.set(windowId, origin.selectedAnnotationId);
    dispatch(selectAnnotation(windowId, origin.selectedAnnotationId));
    requestPinFocus(windowId, origin.selectedAnnotationId);
  }
  if (origin.previewAnnotationId) dispatch(openPreviewOn(windowId, origin.previewAnnotationId, origin.position));
};

// Only the two content locales reach the maps UI - see poiPreviewPlugin.tsx's getContentLocale.
const BACK_LABEL: Record<'en' | 'ar', string> = { ar: 'رجوع', en: 'Back' };

interface SiteBackButtonProps {
  label: string;
  onBack: () => void;
}

/**
 * The site preset's Back: a plain button in the top start corner, where the host's Close sits
 * (`.dbf-map__back`, styled by the host). It takes focus when the nested map opens, and Escape
 * goes back before it would close the whole view (the host listens in the bubble phase).
 */
const SiteBackButton = ({ label, onBack }: SiteBackButtonProps) => {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onBack();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onBack]);

  return (
    <button className="dbf-map__back" onClick={onBack} ref={ref} type="button">
      {label}
    </button>
  );
};

interface NestedMapBackButtonProps {
  backToParentMap: (windowId: string) => void;
  site?: boolean;
  canGoBack: boolean;
  language?: string;
  windowId: string;
}

/**
 * The "Back" button overlaid on the top start corner of a nested map (top left, or top right
 * in Arabic's right-to-left layout), shown only while there is a map to go back to.
 */
const NestedMapBackButton = ({
  backToParentMap: dispatchBackToParentMap,
  canGoBack,
  language,
  site = false,
  windowId,
}: NestedMapBackButtonProps) => {
  const onBack = useCallback(() => dispatchBackToParentMap(windowId), [dispatchBackToParentMap, windowId]);
  if (!canGoBack) return null;
  const locale = (language ?? '').split('-')[0].toLowerCase() === 'ar' ? 'ar' : 'en';
  if (site) return <SiteBackButton label={BACK_LABEL[locale]} onBack={onBack} />;

  return (
    <Button
      color="primary"
      onClick={() => dispatchBackToParentMap(windowId)}
      startIcon={<ArrowBackIcon sx={{ transform: locale === 'ar' ? 'scaleX(-1)' : undefined }} />}
      sx={(theme) => ({
        insetInlineStart: theme.spacing(2),
        position: 'absolute',
        top: theme.spacing(2),
        zIndex: 1000,
      })}
      variant="contained"
    >
      {BACK_LABEL[locale]}
    </Button>
  );
};

const nestedMapBackButtonPlugin = {
  component: NestedMapBackButton,
  mapDispatchToProps: { backToParentMap },
  mapStateToProps: (state: unknown, { windowId }: { windowId: string }) => ({
    canGoBack: getMapHistory(state, windowId).length > 0,
    language: (getConfig(state) as { language?: string }).language,
    site: (getConfig(state) as { maps?: { site?: boolean } }).maps?.site === true,
  }),
  mode: 'add',
  target: 'OpenSeadragonViewer',
};

export const nestedMapPlugins = [nestedMapBackButtonPlugin];
