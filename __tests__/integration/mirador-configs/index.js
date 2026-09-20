import { PRIMARY_CANVAS_FIXTURE_URL, PRIMARY_MANIFEST_FIXTURE_URL } from './constants';
import { poiPreviewPlugins } from '../../../src/plugins/poiPreviewPlugin.tsx';

// Mirador.viewer(config, plugins) takes plugins as its own second argument - MiradorViewer
// reads them from there (see src/lib/MiradorViewer.jsx), not from a `plugins` key nested
// inside `config` - so this is exported separately for demo/index.html to pass along.
export const plugins = poiPreviewPlugins;

// has 2 windows, one gaugin and one bodleian
export default {
  catalog: [
    {
      manifestId: 'https://files.tetras-libre.fr/dev/dbf/mapnile.json',
    },
  ],
  id: 'mirador',
  theme: {
    transitions: {},
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
  windows: [
    {
      manifestId: 'https://files.tetras-libre.fr/dev/dbf/mapnile.json',
    },
  ],
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
