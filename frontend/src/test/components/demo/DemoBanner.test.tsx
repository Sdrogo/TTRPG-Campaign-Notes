import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { apiFetch } from '../../../lib/apiClient';
import { isDemoMode, setDemoMode } from '../../../lib/demo/demoMode';
import { rawAccount } from '../../fixtures';
import { renderWithProviders } from '../../utils';
import { AppHeader } from '../../../components/AppHeader';
import { ViewAsProvider } from '../../../components/ViewAsProvider';

vi.mock('../../../lib/apiClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/apiClient')>()),
  apiFetch: vi.fn(),
}));

const MARCO = 'd3e0c0de-0000-4000-8000-000000000002';
const assign = vi.fn();

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue(rawAccount());
  assign.mockReset();
  vi.stubGlobal('location', { assign });
  setDemoMode(true);
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

function render(route: string) {
  const rendered = renderWithProviders(
    <ViewAsProvider>
      <AppHeader roomId="demo" />
    </ViewAsProvider>,
    { route },
  );
  return { ...rendered, user: userEvent.setup() };
}

describe('DemoBanner', () => {
  it('takes the place of the preview banner in the header while the Demo is on', () => {
    render(`/rooms/demo/documents?as=${MARCO}`);

    expect(screen.getByRole('status')).toHaveTextContent('Demo: una campagna di esempio, in sola lettura.');
    expect(screen.getByRole('radio', { name: 'Marco' })).toBeChecked();
    expect(document.querySelector('.view-as-banner')).not.toBeInTheDocument();
  });

  it('shows nothing of the Demo once it is off', () => {
    setDemoMode(false);
    render('/rooms/demo/documents');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('switches to a Player on the same page with a full page load', async () => {
    const { user } = render('/rooms/demo/documents/doc-1');

    expect(screen.getByRole('radio', { name: 'Master' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Marco' }));

    expect(assign).toHaveBeenCalledWith(`/rooms/demo/documents/doc-1?as=${MARCO}`);
  });

  it('opens the sample Room when switching from a page outside it', async () => {
    const { user } = render('/rooms');

    await user.click(screen.getByRole('radio', { name: 'Giulia' }));

    expect(assign).toHaveBeenCalledWith('/rooms/demo/documents?as=d3e0c0de-0000-4000-8000-000000000003');
  });

  it('switches back to the Master view', async () => {
    const { user } = render(`/rooms/demo/maps?as=${MARCO}`);

    await user.click(screen.getByRole('radio', { name: 'Master' }));

    expect(assign).toHaveBeenCalledWith('/rooms/demo/maps');
  });

  it('leaves the Demo for the landing page or the sign-in', async () => {
    const { user } = render('/rooms/demo/documents');

    await user.click(screen.getByRole('button', { name: 'Esci dalla demo' }));
    expect(assign).toHaveBeenLastCalledWith('/');
    expect(isDemoMode()).toBe(false);

    setDemoMode(true);
    await user.click(screen.getByRole('button', { name: 'Accedi' }));
    expect(assign).toHaveBeenLastCalledWith('/#sign-in');
    expect(isDemoMode()).toBe(false);
  });

  it('reloads the sample content when the language changes, not before', async () => {
    const { queryClient } = render('/rooms/demo/documents');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    expect(invalidate).not.toHaveBeenCalled();
    await act(() => i18n.changeLanguage('en'));

    expect(invalidate).toHaveBeenCalled();
  });
});
