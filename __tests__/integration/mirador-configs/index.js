import { defaultMapViewerConfig } from '../../../src/components/MapViewer';
import { nestedMapPlugins } from '../../../src/plugins/nestedMapPlugin.tsx';
import { poiPreviewPlugins } from '../../../src/plugins/poiPreviewPlugin.tsx';

// Mirador.viewer(config, plugins) takes plugins as its own second argument - MiradorViewer
// reads them from there (see src/lib/MiradorViewer.jsx), not from a `plugins` key nested
// inside `config` - so this is exported separately for demo/index.html to pass along. The same
// plugins MapViewer registers: the POI preview, and the Back button of a nested map it opens.
export const plugins = [...poiPreviewPlugins, ...nestedMapPlugins];

// Same manifest-in/map-out preset the MapViewer component wraps (see demo/map-viewer.html),
// used here directly since demo/index.html predates that component and drives Mirador.viewer()
// itself.
export default {
  ...defaultMapViewerConfig,
  catalog: [
    {
      manifestId: 'https://files.tetras-libre.fr/dev/dbf/mapnile.json',
    },
  ],
  id: 'mirador',
  theme: {
    ...defaultMapViewerConfig.theme,
    // Upstream convention across these fixture configs to avoid animation-related
    // flakiness; unrelated to the map preset itself, so it isn't part of it.
    transitions: {},
  },
  windows: [
    {
      manifestId: 'https://files.tetras-libre.fr/dev/dbf/mapnile.json',
    },
  ],
};
