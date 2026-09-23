import Button from '@mui/material/Button';
import ArrowBackIcon from '@mui/icons-material/ArrowBackSharp';
import {
  getCompanionWindows,
  getConfig,
  getSelectedAnnotationId,
  getWindow,
  getWindowViewType,
  deselectAnnotation,
  removeCompanionWindow,
  setWindowViewType,
  updateWindow,
  // Relative, not `from 'dbf-mirador'` - see poiPreviewPlugin.tsx.
} from '../index';

// Nested maps (issue #427, following #407): a "Nested Map" point is a POI whose
// `dbf:linkedMap` points at another map. Opening it swaps the map shown in the same Mirador
// window for the linked one - rather than opening a second window next to it, as the editor
// does - and a "Back" button overlaid on the map returns to the map it was opened from.
//
// The way back is a stack of the maps opened so far, kept on the window itself
// (`window.mapHistory`) so it lives and dies with the window, and nested maps can themselves
// open further nested maps.

/** The linked-map reference a Nested Map point carries (see the Strapi maps plugin's annotationConversion.ts). */
export type LinkedMap = { id: string; titleEn?: string | null };

/**
 * Resolves a linked map to the URL of its IIIF manifest. Only the host app knows its manifest
 * endpoint, so it's given through Mirador's config (`maps.getLinkedMapManifestId`, which
 * MapViewer's `getLinkedMapManifestId` prop sets) - the same way the annotation editor delegates
 * `annotation.openLinkedMap` to its host.
 */
export type LinkedMapManifestResolver = (linkedMap: LinkedMap) => string | null | undefined;

type MapHistoryEntry = { manifestId: string };
type MiradorWindow = { id: string; manifestId?: string; mapHistory?: MapHistoryEntry[] };
type Dispatch = (action: unknown) => void;
type GetState = () => unknown;

/** The URL of the manifest a linked map resolves to, or null when the host can't resolve it (or gave no resolver). */
export const getLinkedMapManifestId = (state: unknown, linkedMap?: LinkedMap | null): string | null => {
  if (!linkedMap?.id) return null;
  const resolve = (getConfig(state) as { maps?: { getLinkedMapManifestId?: LinkedMapManifestResolver } }).maps
    ?.getLinkedMapManifestId;
  return resolve?.(linkedMap) || null;
};

const getMapHistory = (state: unknown, windowId: string): MapHistoryEntry[] =>
  (getWindow(state, { windowId }) as MiradorWindow | undefined)?.mapHistory ?? [];

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

/** Opens a nested map in place of the window's current map, remembering the way back. */
export const openNestedMap = (windowId: string, manifestId: string) => (dispatch: Dispatch, getState: GetState) => {
  const state = getState();
  const currentManifestId = (getWindow(state, { windowId }) as MiradorWindow | undefined)?.manifestId;
  if (!currentManifestId || currentManifestId === manifestId) return;

  dispatch(switchWindowMap(windowId, manifestId, [...getMapHistory(state, windowId), { manifestId: currentManifestId }]));
};

/** Goes back to the map the current nested map was opened from. */
export const backToParentMap = (windowId: string) => (dispatch: Dispatch, getState: GetState) => {
  const mapHistory = getMapHistory(getState(), windowId);
  const parent = mapHistory[mapHistory.length - 1];
  if (!parent) return;

  dispatch(switchWindowMap(windowId, parent.manifestId, mapHistory.slice(0, -1)));
};

// Only the two content locales reach the maps UI - see poiPreviewPlugin.tsx's getContentLocale.
const BACK_LABEL: Record<'en' | 'ar', string> = { ar: 'رجوع', en: 'Back' };

interface NestedMapBackButtonProps {
  backToParentMap: (windowId: string) => void;
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
  windowId,
}: NestedMapBackButtonProps) => {
  if (!canGoBack) return null;
  const locale = (language ?? '').split('-')[0].toLowerCase() === 'ar' ? 'ar' : 'en';

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
  }),
  mode: 'add',
  target: 'OpenSeadragonViewer',
};

export const nestedMapPlugins = [nestedMapBackButtonPlugin];
