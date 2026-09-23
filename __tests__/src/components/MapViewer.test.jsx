import { render } from '@testing-library/react';
import { viewer } from '../../../src/init';
import { MapViewer } from '../../../src/components/MapViewer';
import { updateConfig } from '../../../src/state/actions/config';

vi.mock('../../../src/init', async (importOriginal) => {
  const actual = await importOriginal();
  const mockViewer = vi.fn();
  return { ...actual, default: { ...actual.default, viewer: mockViewer }, viewer: mockViewer };
});

/** A stand-in Mirador instance whose store only tracks the configured language */
const fakeInstance = (language) => {
  const state = { config: { language } };
  return {
    store: {
      dispatch: vi.fn((action) => {
        state.config = { ...state.config, ...action.config };
      }),
      getState: () => state,
    },
    unmount: vi.fn(),
  };
};

describe('MapViewer', () => {
  beforeEach(() => {
    viewer.mockReset();
    viewer.mockImplementation((config) => fakeInstance(config.language));
  });

  it('starts Mirador in English by default', () => {
    render(<MapViewer manifestId="https://example.com/manifest.json" />);

    expect(viewer).toHaveBeenCalledWith(expect.objectContaining({ language: 'en' }), expect.anything());
  });

  it('starts Mirador in the given language', () => {
    const { container } = render(<MapViewer lang="ar" manifestId="https://example.com/manifest.json" />);

    expect(viewer).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'ar', windows: [{ manifestId: 'https://example.com/manifest.json' }] }),
      expect.anything(),
    );
    // eslint-disable-next-line testing-library/no-node-access -- the wrapper div has no role to query it by
    expect(container.firstChild).toHaveAttribute('lang', 'ar');
  });

  it('switches the running viewer to a new language without recreating it', () => {
    const { rerender } = render(<MapViewer lang="en" manifestId="https://example.com/manifest.json" />);
    const instance = viewer.mock.results[0].value;
    expect(instance.store.dispatch).not.toHaveBeenCalled();

    rerender(<MapViewer lang="ar" manifestId="https://example.com/manifest.json" />);

    expect(viewer).toHaveBeenCalledTimes(1);
    expect(instance.unmount).not.toHaveBeenCalled();
    expect(instance.store.dispatch).toHaveBeenCalledWith(updateConfig({ language: 'ar' }));
  });

  it('keeps the current language when the manifest changes', () => {
    const { rerender } = render(<MapViewer lang="ar" manifestId="https://example.com/a.json" />);

    rerender(<MapViewer lang="ar" manifestId="https://example.com/b.json" />);

    expect(viewer).toHaveBeenCalledTimes(2);
    expect(viewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: 'ar', windows: [{ manifestId: 'https://example.com/b.json' }] }),
      expect.anything(),
    );
  });
});
