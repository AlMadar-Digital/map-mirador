import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PropTypes from 'prop-types';
import { poiPreviewPlugins } from '../../../src/plugins/poiPreviewPlugin.tsx';

// Only the preview's own content is under test here, not Mirador's companion window chrome.
vi.mock('../../../src/index', async (importOriginal) => {
  /** Stand-in for the connected CompanionWindow: just its title and content */
  function CompanionWindowStub({ children = null, header = true, title }) {
    return (
      <section aria-label={title}>
        {header && <h2>{title}</h2>}
        {children}
      </section>
    );
  }
  CompanionWindowStub.propTypes = { children: PropTypes.node, title: PropTypes.string.isRequired };

  CompanionWindowStub.propTypes.header = PropTypes.bool;
  return { ...(await importOriginal()), ConnectedCompanionWindow: CompanionWindowStub };
});

const [{ component: PreviewContent, mapStateToProps }] = poiPreviewPlugins;

const text = (language, purpose, value) => ({ language, purpose, type: 'TextualBody', value });

const stop = (id, title, order) => ({
  body: [text('en', 'identifying', title), text('en', 'describing', `<p>${title} text</p>`)],
  'dbf:journey': { id: 'journey', order },
  'dbf:kind': 'POI',
  id,
  target: { selector: { type: 'PointSelector', x: 10, y: 10 }, source: 'canvas' },
});

const journey = { body: [text('en', 'identifying', 'A journey to the coast')], 'dbf:kind': 'Journey', id: 'journey' };

describe('poiPreviewPlugin site preset', () => {
  describe('mapStateToProps', () => {
    const state = (maps) => ({
      annotations: {},
      companionWindows: { cw: { annotationid: 'poi' } },
      config: { language: 'en', maps },
      windows: { window: {} },
    });

    it('is on only when the config asks for it', () => {
      expect(mapStateToProps(state({ site: true }), { id: 'cw', windowId: 'window' }).site).toBe(true);
      expect(mapStateToProps(state({}), { id: 'cw', windowId: 'window' }).site).toBe(false);
      expect(mapStateToProps(state(undefined), { id: 'cw', windowId: 'window' }).site).toBe(false);
    });
  });

  describe('journey', () => {
    const pois = [stop('a', 'The Start', 1), stop('b', 'Manzil Qastal', 2)];

    it('renders numbered stop cards with the contract class names', () => {
      const { container } = render(
        <PreviewContent
          annotation={journey}
          id="cw"
          journeyPois={pois}
          locale="en"
          position="right"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
        />,
      );

      expect(screen.getByRole('heading', { name: 'Follow the journey' })).toBeInTheDocument();
      /* eslint-disable testing-library/no-container, testing-library/no-node-access -- the class names are the contract */
      const cards = container.querySelectorAll('.dbf-map-poi');
      expect(cards).toHaveLength(2);
      expect(cards[1].querySelector('.dbf-map-poi__marker')).toHaveTextContent('2');
      expect(cards[1].querySelector('.dbf-map-poi__eyebrow')).toHaveTextContent('A journey to the coast');
      expect(container.querySelectorAll('.dbf-map-poi__divider')).toHaveLength(1);
      expect(container.querySelector('[style]:not([aria-hidden])')).toBeNull();
      /* eslint-enable testing-library/no-container, testing-library/no-node-access */
    });

    it('selects a stop from its title button', async () => {
      const selectAnnotation = vi.fn();
      render(
        <PreviewContent
          annotation={journey}
          id="cw"
          journeyPois={pois}
          locale="en"
          position="right"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={selectAnnotation}
          site
          windowId="window"
        />,
      );

      await userEvent.click(screen.getByRole('button', { name: 'Manzil Qastal' }));

      expect(selectAnnotation).toHaveBeenCalledWith('window', 'b');
    });
  });

  describe('panel', () => {
    it("replaces Mirador's title bar with its own label and close button", async () => {
      const removeCompanionWindow = vi.fn();
      render(
        <PreviewContent
          annotation={journey}
          id="cw"
          journeyPois={[stop('a', 'The Start', 1)]}
          locale="ar"
          position="bottom"
          removeCompanionWindow={removeCompanionWindow}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
        />,
      );

      expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 2, name: 'اتبع الرحلة' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'إغلاق اللوحة' }));

      expect(removeCompanionWindow).toHaveBeenCalledWith('window', 'cw');
    });
  });

  describe('POI', () => {
    it('renders a card under the Discover heading', () => {
      const { container } = render(
        <PreviewContent
          annotation={{ ...stop('a', 'Cairo', 1), 'dbf:journey': null }}
          id="cw"
          journeyPois={[]}
          locale="en"
          position="right"
          removeCompanionWindow={vi.fn()}
          selectAnnotation={vi.fn()}
          site
          windowId="window"
        />,
      );

      expect(screen.getByRole('heading', { name: 'Discover the map' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Cairo' })).toBeInTheDocument();
      // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the class name is the contract
      expect(container.querySelector('.dbf-map-poi__text')).toHaveTextContent('Cairo text');
    });
  });
});
