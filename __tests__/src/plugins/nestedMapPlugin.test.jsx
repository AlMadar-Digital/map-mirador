import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import createStore from '../../../src/state/createStore';
import { addCompanionWindow, addWindow, receiveManifest, selectAnnotation, updateConfig } from '../../../src/state/actions';
import { getCompanionWindows, getSelectedAnnotationId, getWindow } from '../../../src/state/selectors';
import {
  backToParentMap,
  getLinkedMapManifestId,
  nestedMapPlugins,
  openNestedMap,
} from '../../../src/plugins/nestedMapPlugin.tsx';
import parentManifest from '../../fixtures/version-2/001.json';
import nestedManifest from '../../fixtures/version-2/002.json';

const PARENT = 'https://example.org/maps/parent/manifest';
const NESTED = 'https://example.org/maps/nested/manifest';
const DEEPER = 'https://example.org/maps/deeper/manifest';

/** A store with the parent map open in window `w`, every map's manifest already loaded (no fetch). */
const setupStore = () => {
  const store = createStore();
  store.dispatch(receiveManifest(PARENT, parentManifest));
  store.dispatch(receiveManifest(NESTED, nestedManifest));
  store.dispatch(receiveManifest(DEEPER, nestedManifest));
  store.dispatch(addWindow({ id: 'w', manifestId: PARENT }));
  return store;
};

const windowOf = (store) => getWindow(store.getState(), { windowId: 'w' });

describe('nestedMapPlugin', () => {
  describe('getLinkedMapManifestId', () => {
    it('resolves a linked map through the configured resolver', () => {
      const store = setupStore();
      store.dispatch(updateConfig({ maps: { getLinkedMapManifestId: ({ id }) => `https://example.org/maps/${id}/manifest` } }));

      expect(getLinkedMapManifestId(store.getState(), { id: 'nested' })).toBe(NESTED);
    });

    it('is null without a linked map or without a resolver', () => {
      const store = setupStore();
      expect(getLinkedMapManifestId(store.getState(), { id: 'nested' })).toBeNull();

      store.dispatch(updateConfig({ maps: { getLinkedMapManifestId: () => NESTED } }));
      expect(getLinkedMapManifestId(store.getState(), null)).toBeNull();
    });
  });

  describe('openNestedMap / backToParentMap', () => {
    it('shows the nested map in the same window and remembers the way back', () => {
      const store = setupStore();
      store.dispatch(openNestedMap('w', NESTED));

      expect(windowOf(store).manifestId).toBe(NESTED);
      expect(windowOf(store).mapHistory).toEqual([{ manifestId: PARENT }]);
    });

    it('goes back up through nested maps one level at a time', () => {
      const store = setupStore();
      store.dispatch(openNestedMap('w', NESTED));
      store.dispatch(openNestedMap('w', DEEPER));
      expect(windowOf(store).mapHistory).toEqual([{ manifestId: PARENT }, { manifestId: NESTED }]);

      store.dispatch(backToParentMap('w'));
      expect(windowOf(store).manifestId).toBe(NESTED);
      expect(windowOf(store).mapHistory).toEqual([{ manifestId: PARENT }]);

      store.dispatch(backToParentMap('w'));
      expect(windowOf(store).manifestId).toBe(PARENT);
      expect(windowOf(store).mapHistory).toEqual([]);

      // nothing left to go back to
      store.dispatch(backToParentMap('w'));
      expect(windowOf(store).manifestId).toBe(PARENT);
    });

    it("leaves behind the previous map's preview and selection", () => {
      const store = setupStore();
      store.dispatch(addCompanionWindow('w', { annotationid: 'poi', content: 'mapsPoiPreview', position: 'right' }));
      store.dispatch(selectAnnotation('w', 'poi'));

      store.dispatch(openNestedMap('w', NESTED));

      const previews = Object.values(getCompanionWindows(store.getState())).filter(
        (cw) => cw.windowId === 'w' && cw.content === 'mapsPoiPreview',
      );
      expect(previews).toEqual([]);
      expect(getSelectedAnnotationId(store.getState(), { windowId: 'w' })).toBeUndefined();
    });

    it('does nothing when asked to open the map already shown', () => {
      const store = setupStore();
      store.dispatch(openNestedMap('w', PARENT));

      expect(windowOf(store).mapHistory).toBeUndefined();
    });
  });

  describe('Back button', () => {
    const [{ component: BackButton, mapStateToProps }] = nestedMapPlugins;

    it('is only shown inside a nested map', () => {
      const store = setupStore();
      expect(mapStateToProps(store.getState(), { windowId: 'w' }).canGoBack).toBe(false);

      store.dispatch(openNestedMap('w', NESTED));
      expect(mapStateToProps(store.getState(), { windowId: 'w' }).canGoBack).toBe(true);
    });

    it('renders nothing when there is no map to go back to', () => {
      const { container } = render(<BackButton backToParentMap={vi.fn()} canGoBack={false} windowId="w" />);
      expect(container).toBeEmptyDOMElement();
    });

    it('goes back to the parent map when clicked, labelled in the viewer language', async () => {
      const back = vi.fn();
      const { rerender } = render(<BackButton backToParentMap={back} canGoBack language="en" windowId="w" />);

      await userEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(back).toHaveBeenCalledWith('w');

      rerender(<BackButton backToParentMap={back} canGoBack language="ar" windowId="w" />);
      expect(screen.getByRole('button', { name: 'رجوع' })).toBeInTheDocument();
    });
  });
});
