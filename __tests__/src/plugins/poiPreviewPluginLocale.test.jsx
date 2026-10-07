import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PropTypes from 'prop-types';
import { editInPlaceOfPreview, getContentLocale, poiPreviewPlugins } from '../../../src/plugins/poiPreviewPlugin.tsx';
import { getVisibleCanvases } from '../../../src/index';

// Only the preview's own content is under test here, not Mirador's companion window chrome.
vi.mock('../../../src/index', async (importOriginal) => {
  /** Stand-in for the connected CompanionWindow: just its title and content */
  function CompanionWindowStub({ children = null, title }) {
    return (
      <section aria-label={title}>
        <h2>{title}</h2>
        {children}
      </section>
    );
  }
  CompanionWindowStub.propTypes = { children: PropTypes.node, title: PropTypes.string.isRequired };

  const actual = await importOriginal();
  return {
    ...actual,
    ConnectedCompanionWindow: CompanionWindowStub,
    getVisibleCanvases: vi.fn(actual.getVisibleCanvases),
  };
});

const [{ component: PreviewContent, mapStateToProps }] = poiPreviewPlugins;

const text = (language, purpose, value) => ({ language, purpose, type: 'TextualBody', value });

const poi = {
  body: [
    text('en', 'identifying', 'Cairo'),
    text('en', 'describing', '<p>City on the Nile</p>'),
    text('ar', 'identifying', 'القاهرة'),
    text('ar', 'describing', '<p>مدينة على النيل</p>'),
  ],
  'dbf:journey': { id: 'journey', order: 1 },
  'dbf:kind': 'POI',
  id: 'poi',
};

const journey = {
  body: [text('en', 'identifying', 'Down the Nile'), text('ar', 'identifying', 'على طول النيل')],
  'dbf:kind': 'Journey',
  id: 'journey',
};

/** Renders the preview for an annotation in a given content locale */
const renderPreview = (annotation, locale, journeyPois = []) =>
  render(
    <PreviewContent
      annotation={annotation}
      id="cw"
      journeyPois={journeyPois}
      locale={locale}
      selectAnnotation={vi.fn()}
      windowId="window"
    />,
  );

describe('poiPreviewPlugin locale', () => {
  describe('getContentLocale', () => {
    it('maps Arabic languages to ar and everything else to en', () => {
      expect(getContentLocale('ar')).toBe('ar');
      expect(getContentLocale('ar-EG')).toBe('ar');
      expect(getContentLocale('en')).toBe('en');
      expect(getContentLocale('fr')).toBe('en');
      expect(getContentLocale(undefined)).toBe('en');
    });
  });

  describe('mapStateToProps', () => {
    it("follows Mirador's configured language", () => {
      const state = (language) => ({
        annotations: {},
        companionWindows: { cw: { annotationid: 'poi' } },
        config: { language },
        windows: { window: {} },
      });

      expect(mapStateToProps(state('ar'), { id: 'cw', windowId: 'window' }).locale).toBe('ar');
      expect(mapStateToProps(state('en'), { id: 'cw', windowId: 'window' }).locale).toBe('en');
    });
  });

  describe('POI preview', () => {
    it('shows only the English content in en', () => {
      renderPreview(poi, 'en');

      expect(screen.getByRole('heading', { name: 'Cairo' })).toBeInTheDocument();
      expect(screen.getByText('City on the Nile')).toBeInTheDocument();
      expect(screen.queryByText('القاهرة')).not.toBeInTheDocument();
      expect(screen.queryByText('مدينة على النيل')).not.toBeInTheDocument();
    });

    it('shows only the Arabic content, right-to-left, in ar', () => {
      renderPreview(poi, 'ar');

      expect(screen.getByRole('heading', { name: 'القاهرة' })).toBeInTheDocument();
      const description = screen.getByText('مدينة على النيل');
      // eslint-disable-next-line testing-library/no-node-access -- `dir` sits on the content wrapper, which has no role
      expect(description.closest('[dir]')).toHaveAttribute('dir', 'rtl');
      expect(screen.queryByText('Cairo')).not.toBeInTheDocument();
    });

    it('localizes its own messages', () => {
      renderPreview(null, 'ar');

      expect(screen.getByText('تعذر العثور على هذا العنصر - ربما تم حذفه.')).toBeInTheDocument();
    });
  });

  describe('Nested Map point preview', () => {
    const nestedMapPoi = { ...poi, 'dbf:journey': null, 'dbf:linkedMap': { id: 'nested' } };

    it('opens the linked map in place of the current one', async () => {
      const openNestedMap = vi.fn();
      render(
        <PreviewContent
          annotation={nestedMapPoi}
          id="cw"
          journeyPois={[]}
          linkedMapManifestId="https://example.org/maps/nested/manifest"
          locale="en"
          openNestedMap={openNestedMap}
          selectAnnotation={vi.fn()}
          windowId="window"
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Open map' }));

      expect(openNestedMap).toHaveBeenCalledWith('window', 'https://example.org/maps/nested/manifest');
    });

    it('has no "Open map" button when the linked map cannot be resolved', () => {
      renderPreview(nestedMapPoi, 'en');

      expect(screen.queryByRole('button', { name: 'Open map' })).not.toBeInTheDocument();
    });
  });

  describe('journey preview', () => {
    it('shows the journey and its stops in the given language, without a language toggle', () => {
      renderPreview(journey, 'ar', [poi]);

      expect(screen.getByRole('heading', { name: 'على طول النيل' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /القاهرة/ })).toHaveAttribute('title', 'عرض على الخريطة');
      expect(screen.queryByText('Cairo')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'EN' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'AR' })).not.toBeInTheDocument();
    });

    it('localizes the empty-journey message', () => {
      renderPreview(journey, 'en', []);

      expect(screen.getByText('This journey has no stops yet.')).toBeInTheDocument();
    });
  });

  describe('in the annotation editor', () => {
    const editablePoi = { ...poi, 'dbf:journey': null, maeData: {} };

    /** Renders the preview as it appears alongside dbf-mirador-annotation-editor */
    const renderEditorPreview = (props = {}) =>
      render(
        <PreviewContent
          annotation={editablePoi}
          canEdit
          editInPlaceOfPreview={vi.fn()}
          hasAnnotationEditor
          id="cw"
          journeyPois={[]}
          locale="en"
          selectAnnotation={vi.fn()}
          windowId="window"
          {...props}
        />,
      );

    it('switches the content between English and Arabic', async () => {
      renderEditorPreview();

      expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('City on the Nile')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'العربية' }));

      expect(screen.getByRole('heading', { name: 'القاهرة' })).toBeInTheDocument();
      const description = screen.getByText('مدينة على النيل');
      // eslint-disable-next-line testing-library/no-node-access -- `dir` sits on the content wrapper, which has no role
      expect(description.closest('[dir]')).toHaveAttribute('dir', 'rtl');
      expect(screen.queryByText('City on the Nile')).not.toBeInTheDocument();

      // Clicking the active language again keeps it selected.
      await userEvent.click(screen.getByRole('button', { name: 'العربية' }));
      expect(screen.getByText('مدينة على النيل')).toBeInTheDocument();
    });

    it('switches a journey and its stops too', async () => {
      renderEditorPreview({ annotation: journey, journeyPois: [poi] });

      await userEvent.click(screen.getByRole('button', { name: 'العربية' }));

      expect(screen.getByRole('heading', { name: 'على طول النيل' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'القاهرة' })).toBeInTheDocument();
    });

    it("opens the editor's edit window in place of this preview", async () => {
      const editInPlaceOfPreviewMock = vi.fn();
      renderEditorPreview({ editInPlaceOfPreview: editInPlaceOfPreviewMock });

      await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

      expect(editInPlaceOfPreviewMock).toHaveBeenCalledWith('window', 'cw', 'poi');
    });

    describe('editInPlaceOfPreview (issue #457)', () => {
      it('closes the companion windows beside the map but the sidebar, and remembers the preview', () => {
        const companionWindows = {
          cw: { annotationid: 'journey', content: 'mapsPoiPreview', id: 'cw', position: 'right', windowId: 'window' },
          info: { content: 'info', id: 'info', position: 'far-right', windowId: 'window' },
          other: { content: 'mapsPoiPreview', id: 'other', position: 'right', windowId: 'elsewhere' },
          side: { content: 'annotations', id: 'side', position: 'left', windowId: 'window' },
        };
        const dispatch = vi.fn();
        editInPlaceOfPreview('window', 'cw', 'poi')(dispatch, () => ({ companionWindows }));
        const actions = dispatch.mock.calls.map(([action]) => action);

        expect(actions.filter(({ type }) => type === 'mirador/REMOVE_COMPANION_WINDOW').map(({ id }) => id)).toEqual([
          'cw',
          'info',
        ]);
        expect(actions.at(-1)).toEqual(
          expect.objectContaining({
            payload: expect.objectContaining({
              annotationid: 'poi',
              content: 'annotationCreation',
              position: 'right',
              returnToPreview: { annotationid: 'journey', position: 'right' },
            }),
            type: 'mirador/ADD_COMPANION_WINDOW',
            windowId: 'window',
          }),
        );
      });
    });

    it('disables Edit while an edit window is open', () => {
      renderEditorPreview({ isEditing: true });

      expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    });

    it('has no Edit button for an annotation it cannot edit', () => {
      renderEditorPreview({ canEdit: false });

      expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    });

    it('labels its controls in the UI language', () => {
      renderEditorPreview({ locale: 'ar' });

      expect(screen.getByRole('button', { name: 'تعديل' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'العربية' })).toHaveAttribute('aria-pressed', 'true');
    });

    describe("a journey's stops (issue #457)", () => {
      const editableStop = { ...poi, maeData: {} };
      const lockedStop = { ...poi, id: 'locked', maeData: undefined };
      const renderJourney = (props = {}) =>
        renderEditorPreview({
          annotation: journey,
          canEditAnnotations: true,
          journeyPois: [editableStop, lockedStop],
          ...props,
        });

      it('previews a stop on its own, keeping it selected', async () => {
        const selectAnnotation = vi.fn();
        const updateCompanionWindow = vi.fn();
        renderJourney({ selectAnnotation, updateCompanionWindow });

        await userEvent.click(screen.getAllByRole('button', { name: 'Preview this stop' })[0]);

        expect(updateCompanionWindow).toHaveBeenCalledWith('window', 'cw', { annotationid: 'poi' });
        expect(selectAnnotation).toHaveBeenCalledWith('window', 'poi');
      });

      it('edits a stop in place of the journey preview, only when it can be edited', async () => {
        const editStop = vi.fn();
        renderJourney({ editInPlaceOfPreview: editStop });

        const editButtons = screen.getAllByRole('button', { name: 'Edit this stop' });
        expect(editButtons).toHaveLength(1);
        await userEvent.click(editButtons[0]);

        expect(editStop).toHaveBeenCalledWith('window', 'cw', 'poi');
      });

      it('has no Edit on its stops when the editor is read-only', () => {
        renderJourney({ canEditAnnotations: false });

        expect(screen.getAllByRole('button', { name: 'Preview this stop' })).toHaveLength(2);
        expect(screen.queryByRole('button', { name: 'Edit this stop' })).not.toBeInTheDocument();
      });

      it('has no stop actions outside the editor', () => {
        render(
          <PreviewContent
            annotation={journey}
            id="cw"
            journeyPois={[editableStop]}
            locale="en"
            selectAnnotation={vi.fn()}
            windowId="window"
          />,
        );

        expect(screen.queryByRole('button', { name: 'Preview this stop' })).not.toBeInTheDocument();
      });

      it("leads a stop's own preview back to its journey", async () => {
        const selectAnnotation = vi.fn();
        const updateCompanionWindow = vi.fn();
        renderEditorPreview({ journey, selectAnnotation, updateCompanionWindow });

        await userEvent.click(screen.getByRole('button', { name: 'Back to journey: Down the Nile' }));

        expect(updateCompanionWindow).toHaveBeenCalledWith('window', 'cw', { annotationid: 'journey' });
        expect(selectAnnotation).toHaveBeenCalledWith('window', 'poi');
      });
    });

    describe('mapStateToProps', () => {
      const state = ({ annotation = {}, companionWindows = {} } = {}) => ({
        annotations: {},
        companionWindows: { cw: { annotationid: 'poi' }, ...companionWindows },
        config: { annotation },
        windows: { window: { companionWindowIds: ['cw', ...Object.keys(companionWindows)] } },
      });
      const props = (s) => mapStateToProps(s, { id: 'cw', windowId: 'window' });

      it('detects the annotation editor from its storage adapter', () => {
        expect(props(state()).hasAnnotationEditor).toBe(false);
        expect(props(state({ annotation: { adapter: () => {} } })).hasAnnotationEditor).toBe(true);
      });

      it("finds a POI's journey on the canvas", () => {
        const canvasState = {
          annotations: { canvas: { page: { json: { items: [poi, journey] } } } },
          companionWindows: { cw: { annotationid: 'poi' } },
          config: {},
          manifests: {},
          windows: { window: {} },
        };
        getVisibleCanvases.mockReturnValueOnce([{ id: 'canvas' }]);

        expect(mapStateToProps(canvasState, { id: 'cw', windowId: 'window' }).journey).toBe(journey);
      });

      it('knows when an edit window is open', () => {
        expect(props(state()).isEditing).toBe(false);
        expect(
          props(state({ companionWindows: { edit: { content: 'annotationCreation', windowId: 'window' } } })).isEditing,
        ).toBe(true);
      });
    });
  });
});
