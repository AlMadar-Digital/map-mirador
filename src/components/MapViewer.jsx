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
    sideBarOpenByDefault: true,
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
