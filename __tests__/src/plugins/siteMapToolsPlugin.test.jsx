import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OSDReferences } from '../../../src/plugins/OSDReferences';
import { MAP_INFO_ID } from '../../../src/plugins/poiPreviewPlugin.tsx';
import { setPanelCollapsed } from '../../../src/plugins/sitePanelState.ts';
import { siteMapToolsPlugin } from '../../../src/plugins/siteMapToolsPlugin.tsx';

const { component: SiteMapTools } = siteMapToolsPlugin;

/** Stand-in for Mirador's own canvas navigation bar */
function NavigationStub() {
  return <nav aria-label="Mirador navigation" />;
}

/** A stand-in OpenSeadragon viewer that records its event handlers */
const fakeViewer = () => {
  const handlers = {};
  return {
    addHandler: (name, handler) => {
      handlers[name] = handler;
    },
    fire: (name) => handlers[name]?.(),
    handlers,
    removeHandler: (name) => {
      delete handlers[name];
    },
    viewport: { applyConstraints: vi.fn(), zoomBy: vi.fn() },
  };
};

const renderTools = (props = {}) =>
  render(
    <SiteMapTools
      TargetComponent={NavigationStub}
      addCompanionWindow={vi.fn()}
      hasMapInfo={false}
      locale="en"
      panelPosition="right"
      previewAnnotationId="poi"
      previewId="cw"
      updateCompanionWindow={vi.fn()}
      requiredStatement={[]}
      rights={[]}
      site
      targetProps={{ windowId: 'window' }}
      {...props}
    />,
  );

describe('siteMapToolsPlugin', () => {
  afterEach(() => {
    OSDReferences.refs = {};
    setPanelCollapsed('window', false);
  });

  it("keeps Mirador's navigation bar outside the site preset", () => {
    renderTools({ site: false });

    expect(screen.getByRole('navigation', { name: 'Mirador navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
  });

  it('zooms the map in and out', async () => {
    const viewer = fakeViewer();
    const { viewport } = viewer;
    OSDReferences.set('window', { current: viewer });
    renderTools();

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));

    expect(viewport.zoomBy).toHaveBeenNthCalledWith(1, 1.5);
    expect(viewport.zoomBy).toHaveBeenNthCalledWith(2, 1 / 1.5);
    expect(viewport.applyConstraints).toHaveBeenCalledTimes(2);
  });

  it('collapses and reopens the panel from its tab', async () => {
    renderTools();

    await userEvent.click(screen.getByRole('button', { name: 'Hide panel' }));
    expect(screen.getByRole('button', { name: 'Show panel' })).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Show panel' }));
    expect(screen.getByRole('button', { name: 'Hide panel' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('has no tab without a side panel or map information', () => {
    renderTools({ panelPosition: null, previewAnnotationId: null, previewId: null });

    expect(screen.queryByRole('button', { name: /panel/ })).not.toBeInTheDocument();
  });

  describe('Discover the map', () => {
    it('opens with the view when the map has a title or description', () => {
      const addCompanionWindow = vi.fn();
      renderTools({ addCompanionWindow, hasMapInfo: true, panelPosition: null, previewAnnotationId: null, previewId: null });

      expect(addCompanionWindow).toHaveBeenCalledTimes(1);
      expect(addCompanionWindow).toHaveBeenCalledWith('window', expect.objectContaining({ annotationid: MAP_INFO_ID }));
    });

    it('does not replace a panel that is already open', () => {
      const addCompanionWindow = vi.fn();
      renderTools({ addCompanionWindow, hasMapInfo: true });

      expect(addCompanionWindow).not.toHaveBeenCalled();
    });

    it('reopens from the tab when no panel is open', async () => {
      const addCompanionWindow = vi.fn();
      renderTools({ addCompanionWindow, hasMapInfo: true, panelPosition: null, previewAnnotationId: null, previewId: null });
      addCompanionWindow.mockClear();

      await userEvent.click(screen.getByRole('button', { name: 'Show panel' }));

      expect(addCompanionWindow).toHaveBeenCalledWith('window', expect.objectContaining({ annotationid: MAP_INFO_ID }));
    });
  });

  it('shows the image rights on request, and no button without any', async () => {
    const { unmount } = renderTools({ requiredStatement: [{ label: 'Attribution', values: ['Vatican Library'] }] });

    expect(screen.queryByText('Vatican Library')).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Image rights' }));
    expect(screen.getByText('Vatican Library')).toBeVisible();
    unmount();

    renderTools();
    expect(screen.queryByRole('button', { name: 'Image rights' })).not.toBeInTheDocument();
  });
});
