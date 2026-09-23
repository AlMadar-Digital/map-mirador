import { render, screen } from '@testing-library/react';
import PropTypes from 'prop-types';
import { getContentLocale, poiPreviewPlugins } from '../../../src/plugins/poiPreviewPlugin.tsx';

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

  return { ...(await importOriginal()), ConnectedCompanionWindow: CompanionWindowStub };
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
});
