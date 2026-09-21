import { expect, it } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { setupIntegrationTestViewer } from '@tests/utils/test-utils';
import config from '../mirador-configs/blank';

describe('Basic end to end Mirador', () => {
  setupIntegrationTestViewer(config);

  it('Adds a manifest and displays it', async () => {
    // Start on empty viewer
    fireEvent.click(await screen.findByRole('button', { name: 'Start Here' }));

    // Now we are in the resource list view
    fireEvent.click(screen.getByRole('button', { name: 'Add resource' }));

    // Input a manifest URL
    // eslint-disable-next-line testing-library/no-node-access
    fireEvent.change(document.getElementById('manifestURL'), {
      target: {
        value: '__tests__/fixtures/version-3/0001-mvm-image.json',
      },
    });

    fireEvent.click(screen.getByText('Add'));

    // Click the added manifest item
    // eslint-disable-next-line testing-library/no-node-access
    const listItem = document.querySelector('[data-manifestid="__tests__/fixtures/version-3/0001-mvm-image.json"]');
    const button = await within(listItem).findByRole('button');
    fireEvent.click(button);

    // The viewer is loaded with the manifest
    const element = await screen.findByRole('heading', {
      name: /Single Image Example/i,
    });
    expect(element).toBeInTheDocument();

    // Switching to elastic mode should keep the loaded manifest visible
    fireEvent.click(screen.getByRole('button', { name: 'Workspace settings' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Select workspace type/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Elastic/i }));

    expect(
      await screen.findByRole('heading', {
        name: /Single Image Example/i,
      }),
    ).toBeInTheDocument();
  });
});
