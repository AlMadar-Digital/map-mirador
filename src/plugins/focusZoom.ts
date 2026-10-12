// How far "focus on this POI" zooms in, shared by the panel's focus (poiPreviewPlugin.tsx) and
// the opening view (fillView.ts) - its own module so neither has to import the other.

// Relative to the whole-map (home) zoom - a ratio rather than an absolute zoom, since Mirador's
// viewport is in canvas pixels so absolute zoom levels differ from one map to another.
export const POI_FOCUS_ZOOM_RATIO = 4;

type ZoomViewport = {
  getHomeZoom: () => number;
  getMaxZoom: () => number;
  getZoom: (current?: boolean) => number;
};

/**
 * The zoom a focus on a POI lands on: zoomed in to the focus ratio, but never further out than
 * the map already is (a visitor who is closer in stays there) and never past the maximum.
 */
export const poiFocusZoom = (viewport: ZoomViewport) =>
  Math.min(viewport.getMaxZoom(), Math.max(viewport.getZoom(), viewport.getHomeZoom() * POI_FOCUS_ZOOM_RATIO));
