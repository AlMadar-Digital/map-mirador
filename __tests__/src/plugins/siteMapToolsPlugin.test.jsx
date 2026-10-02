import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OSDReferences } from '../../../src/plugins/OSDReferences';
import { siteMapToolsPlugin } from '../../../src/plugins/siteMapToolsPlugin.tsx';

const { component: SiteMapTools } = siteMapToolsPlugin;

/** Stand-in for Mirador's own canvas navigation bar */
function NavigationStub() {
  return <nav aria-label="Mirador navigation" />;
}

const renderTools = (props = {}) =>
  render(
    <SiteMapTools
      TargetComponent={NavigationStub}
      locale="en"
      panelPosition="right"
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
  });

  it("keeps Mirador's navigation bar outside the site preset", () => {
    renderTools({ site: false });

    expect(screen.getByRole('navigation', { name: 'Mirador navigation' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
  });

  it('zooms the map in and out', async () => {
    const viewport = { applyConstraints: vi.fn(), zoomBy: vi.fn() };
    OSDReferences.set('window', { current: { viewport } });
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

  it('has no tab without a side panel', () => {
    renderTools({ panelPosition: null });

    expect(screen.queryByRole('button', { name: 'Hide panel' })).not.toBeInTheDocument();
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
