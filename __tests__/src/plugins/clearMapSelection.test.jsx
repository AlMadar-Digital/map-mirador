import createStore from '../../../src/state/createStore';
import {
  addCompanionWindow,
  addWindow,
  receiveManifest,
  selectAnnotation,
  updateCompanionWindow,
} from '../../../src/state/actions';
import { getCompanionWindows, getSelectedAnnotationId } from '../../../src/state/selectors';
import { clearMapSelection } from '../../../src/plugins/poiPreviewPlugin.tsx';
import { isRestoredSelection, openNestedMap, backToParentMap } from '../../../src/plugins/nestedMapPlugin.tsx';
import { MAP_INFO_ID, NESTED_ORIGIN_ID, POI_PREVIEW_CONTENT_ID } from '../../../src/plugins/previewIds.ts';
import { consumeOpenMinimised, getSheetSnap, resetSheet, setPanelCollapsed } from '../../../src/plugins/sitePanelState.ts';

const MAP = 'https://example.org/maps/map/manifest';
const UNTITLED = 'https://example.org/maps/untitled/manifest';
const NESTED = 'https://example.org/maps/nested/manifest';

const manifest = (id, about = {}) => ({
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  id,
  items: [{ height: 1000, id: `${id}/canvas/1`, type: 'Canvas', width: 1000 }],
  type: 'Manifest',
  ...about,
});

/** A store with a map open in window `w` and, unless `preview` is null, its panel on `preview`. */
const setupStore = ({ manifestId = MAP, position = 'right', preview = 'poi', selected = 'poi' } = {}) => {
  const store = createStore();
  store.dispatch(receiveManifest(MAP, manifest(MAP, { label: { en: ['The Nile'] }, summary: { en: ['A map of the river.'] } })));
  store.dispatch(receiveManifest(UNTITLED, manifest(UNTITLED)));
  store.dispatch(receiveManifest(NESTED, manifest(NESTED, { label: { en: ['A detail'] } })));
  store.dispatch(addWindow({ id: 'w', manifestId }));
  if (preview) store.dispatch(addCompanionWindow('w', { annotationid: preview, content: POI_PREVIEW_CONTENT_ID, position }));
  if (selected) store.dispatch(selectAnnotation('w', selected));
  return store;
};

const panelOf = (store) =>
  Object.values(getCompanionWindows(store.getState())).find((cw) => cw.content === POI_PREVIEW_CONTENT_ID);
const selectedIn = (store) => getSelectedAnnotationId(store.getState(), { windowId: 'w' });

describe('clearMapSelection (AlMadar-Digital/platform#481)', () => {
  afterEach(() => {
    consumeOpenMinimised('w');
    resetSheet('w');
  });

  it("clears the selection and shows the map's own title and description", () => {
    const store = setupStore();
    const panelId = panelOf(store).id;

    store.dispatch(clearMapSelection('w'));

    expect(selectedIn(store)).toBeFalsy();
    // The same panel, on "Discover the map" - not a second one.
    expect(panelOf(store)).toMatchObject({ annotationid: MAP_INFO_ID, id: panelId, position: 'right' });
    expect(consumeOpenMinimised('w')).toBe(false);
  });

  it("leaves a journey's panel for the map's too, with no stop selected", () => {
    const store = setupStore({ preview: 'journey', selected: 'stop-2' });

    store.dispatch(clearMapSelection('w'));

    expect(selectedIn(store)).toBeFalsy();
    expect(panelOf(store).annotationid).toBe(MAP_INFO_ID);
  });

  it('keeps a panel slid away behind its tab where it is', () => {
    const store = setupStore();
    setPanelCollapsed('w', true);

    store.dispatch(clearMapSelection('w'));

    expect(panelOf(store).annotationid).toBe(MAP_INFO_ID);
    expect(consumeOpenMinimised('w')).toBe(true);
  });

  it("drops the phone's sheet to its header", () => {
    const store = setupStore({ position: 'bottom' });
    expect(getSheetSnap('w')).toBe('half');

    store.dispatch(clearMapSelection('w'));

    expect(panelOf(store)).toMatchObject({ annotationid: MAP_INFO_ID, position: 'bottom' });
    expect(consumeOpenMinimised('w')).toBe(true);
  });

  it('does nothing to a panel already on the map, or one the visitor closed', () => {
    const onMapInfo = setupStore({ preview: MAP_INFO_ID, selected: null });
    const before = onMapInfo.getState();
    onMapInfo.dispatch(clearMapSelection('w'));
    expect(onMapInfo.getState()).toBe(before);
    expect(consumeOpenMinimised('w')).toBe(false);

    const closed = setupStore({ preview: null, selected: null });
    closed.dispatch(clearMapSelection('w'));
    expect(panelOf(closed)).toBeUndefined();
  });

  it('closes the panel of a map with nothing to say about itself', () => {
    const store = setupStore({ manifestId: UNTITLED });

    store.dispatch(clearMapSelection('w'));

    expect(selectedIn(store)).toBeFalsy();
    expect(panelOf(store)).toBeUndefined();
  });

  it('goes back, in a nested map, to the POI it was opened from', () => {
    const store = setupStore();
    store.dispatch(openNestedMap('w', NESTED, { annotation: { id: 'poi' }, position: 'right', previewAnnotationId: 'poi' }));
    expect(panelOf(store).annotationid).toBe(NESTED_ORIGIN_ID);

    // Nothing selected yet in the nested map: a click on it changes nothing.
    const before = store.getState();
    store.dispatch(clearMapSelection('w'));
    expect(store.getState()).toBe(before);

    // A POI of the nested map's own is picked: the panel moves on to it.
    store.dispatch(selectAnnotation('w', 'detail'));
    store.dispatch(updateCompanionWindow('w', panelOf(store).id, { annotationid: 'detail' }));
    expect(panelOf(store).annotationid).toBe('detail');

    store.dispatch(clearMapSelection('w'));

    expect(selectedIn(store)).toBeFalsy();
    expect(panelOf(store).annotationid).toBe(NESTED_ORIGIN_ID);
  });

  it("forgets the selection Back restored: picking that POI again is the visitor's doing", () => {
    const store = setupStore();
    store.dispatch(
      openNestedMap('w', NESTED, {
        annotation: { id: 'poi' },
        position: 'right',
        previewAnnotationId: 'poi',
        selectedAnnotationId: 'poi',
      }),
    );
    store.dispatch(backToParentMap('w'));
    expect(selectedIn(store)).toBe('poi');

    store.dispatch(clearMapSelection('w'));

    expect(isRestoredSelection('w', 'poi')).toBe(false);
  });
});
