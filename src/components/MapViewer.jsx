import { useEffect, useId, useRef } from 'react';
import PropTypes from 'prop-types';
import { viewer } from '../init';
import { updateConfig } from '../state/actions/config';
import { poiPreviewPlugins } from '../plugins/poiPreviewPlugin.tsx';
import { nestedMapPlugins } from '../plugins/nestedMapPlugin.tsx';
import { mapInteractionPlugins } from '../plugins/mapInteractionPlugin.tsx';

// Hides Mirador's generic multi-window IIIF-viewer chrome (top bar, workspace controls,
// canvas panel) so a manifest reads as a single interactive map rather than a document
// viewer, and opens straight onto the annotation sidebar since that's where a map's
// POIs/journeys live. Exported so callers who need Mirador's raw `viewer()`/`Mirador.viewer()`
// API (e.g. the integration demo config) can build on the same preset instead of copying it.
export const defaultMapViewerConfig = {
  theme: {
    components: {
      // Companion windows (e.g. the POI/journey preview) float over the map instead of
      // taking space next to it, so opening one slides it in without resizing the canvas.
      Window: {
        styleOverrides: {
          bottom: ({ theme }) => ({
            bottom: 0,
            left: 0,
            position: 'absolute',
            right: 0,
            zIndex: theme.zIndex.appBar - 2,
            '& .mirador-companion-window-bottom': {
              boxShadow: theme.shadows[8],
            },
          }),
          column: {
            position: 'relative',
          },
          right: ({ theme }) => ({
            bottom: 0,
            insetInlineEnd: 0,
            position: 'absolute',
            top: 0,
            zIndex: theme.zIndex.appBar - 2,
            '& .mirador-companion-window-right, & .mirador-companion-window-far-right': {
              boxShadow: theme.shadows[8],
            },
          }),
          row: {
            position: 'relative',
          },
        },
      },
      WindowTopBar: {
        styleOverrides: {
          root: {
            display: 'none',
          },
        },
      },
    },
  },
  window: {
    defaultSideBarPanel: 'annotations',
    // Closed by default (issue #410): the left sidebar (annotation list, table of
    // contents, etc.) is Mirador's own document-viewer chrome, not part of the map UI -
    // POIs/journeys are opened through the canvas or the poiPreview companion window
    // instead. `highlightAllAnnotations` still draws markers on the canvas regardless.
    sideBarOpenByDefault: false,
    highlightAllAnnotations: true,
    panels: {
      canvas: false,
    },
  },
  workspaceControlPanel: {
    enabled: false,
  },
};

/** Languages a map's content (and so its viewer) is authored in. */
export const MAP_VIEWER_LANGUAGES = ['en', 'ar'];

/**
 * Drop-in map renderer: give it a IIIF manifest URL, get Mirador pre-configured to look
 * and behave like a map instead of a generic multi-window viewer. Wraps `viewer()` so
 * callers don't need to know Mirador's own instantiation/config API.
 *
 * `lang` drives both Mirador's own UI (labels, and right-to-left layout for Arabic) and the
 * POI/journey previews, which show only that language's content.
 *
 * A Nested Map point's preview gets an "Open map" button, which shows the linked map in place
 * of the current one with a "Back" button. The linked map's manifest URL comes from the
 * annotation (`dbf:linkedMap.manifestId`); `getLinkedMapManifestId` is only needed for
 * annotations that don't carry it, turning their linked map (`{ id }`) into a manifest URL.
 *
 * The mouse wheel tours the map's POIs (in their `dbf:order`, journeys unrolled into their
 * stops) instead of zooming - see mapInteractionPlugin.tsx. Shift+wheel, pinch-to-zoom and
 * the zoom controls still zoom. On a touch screen, a quick horizontal swipe steps through them
 * the same way, while a slower drag still pans.
 */
export function MapViewer({ getLinkedMapManifestId = undefined, lang = 'en', manifestId }) {
  const baseId = useId().replace(/:/g, '');
  const wrapperRef = useRef(null);
  const instanceRef = useRef(null);
  // Called through a ref, so a new resolver function on each render doesn't rebuild the viewer.
  const getLinkedMapManifestIdRef = useRef(getLinkedMapManifestId);
  getLinkedMapManifestIdRef.current = getLinkedMapManifestId;
  const hasLinkedMapResolver = !!getLinkedMapManifestId;
  // Read when the viewer is (re)created, so a `lang` change alone doesn't rebuild it - the
  // effect below switches the running viewer's language instead, keeping the map's viewport.
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;

    const container = document.createElement('div');
    container.id = `mirador-map-viewer-${baseId}`;
    container.style.position = 'absolute';
    container.style.inset = 0;
    wrapper.appendChild(container);

    const instance = viewer(
      {
        ...defaultMapViewerConfig,
        id: container.id,
        language: langRef.current,
        maps: {
          getLinkedMapManifestId: hasLinkedMapResolver
            ? (linkedMap) => getLinkedMapManifestIdRef.current?.(linkedMap)
            : undefined,
        },
        windows: [{ manifestId }],
      },
      [...poiPreviewPlugins, ...nestedMapPlugins, ...mapInteractionPlugins],
    );
    instanceRef.current = instance;

    return () => {
      instanceRef.current = null;
      instance.unmount();
      container.remove();
    };
  }, [baseId, hasLinkedMapResolver, manifestId]);

  useEffect(() => {
    const store = instanceRef.current?.store;
    if (store && store.getState().config.language !== lang) {
      store.dispatch(updateConfig({ language: lang }));
    }
  }, [lang]);

  // `dir` as well as `lang`: Mirador turns its theme right-to-left for Arabic, but - like its own
  // RTL demo - leaves the text direction to its container, so without it titles and headers
  // would still be laid out left-to-right.
  return (
    <div
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      lang={lang}
      ref={wrapperRef}
      style={{ height: '100%', position: 'relative', width: '100%' }}
    />
  );
}

MapViewer.propTypes = {
  /** Resolves a Nested Map point's linked map (`{ id, titleEn }`) to its manifest URL, when its annotation has no `dbf:linkedMap.manifestId`. */
  getLinkedMapManifestId: PropTypes.func,
  /** Language of the viewer's UI and of the POI/journey content it previews. */
  lang: PropTypes.oneOf(MAP_VIEWER_LANGUAGES),
  /** URL of the IIIF manifest to render as a map. */
  manifestId: PropTypes.string.isRequired,
};
