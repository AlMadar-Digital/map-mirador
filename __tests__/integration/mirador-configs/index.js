import { PRIMARY_CANVAS_FIXTURE_URL, PRIMARY_MANIFEST_FIXTURE_URL } from './constants';

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
  },
};
