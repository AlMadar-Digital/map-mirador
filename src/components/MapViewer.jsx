import { useEffect, useId, useRef } from 'react';
import PropTypes from 'prop-types';
import { viewer } from '../init';
import { poiPreviewPlugins } from '../plugins/poiPreviewPlugin.tsx';

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

/**
 * Drop-in map renderer: give it a IIIF manifest URL, get Mirador pre-configured to look
 * and behave like a map instead of a generic multi-window viewer. Wraps `viewer()` so
 * callers don't need to know Mirador's own instantiation/config API.
 */
export function MapViewer({ manifestId }) {
  const baseId = useId().replace(/:/g, '');
  const wrapperRef = useRef(null);

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
        windows: [{ manifestId }],
      },
      poiPreviewPlugins,
    );

    return () => {
      instance.unmount();
      container.remove();
    };
  }, [baseId, manifestId]);

  return <div ref={wrapperRef} style={{ height: '100%', position: 'relative', width: '100%' }} />;
}

MapViewer.propTypes = {
  /** URL of the IIIF manifest to render as a map. */
  manifestId: PropTypes.string.isRequired,
};
