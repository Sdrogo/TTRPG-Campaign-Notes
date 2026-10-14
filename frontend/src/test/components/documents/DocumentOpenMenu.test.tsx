import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../utils';
import { matchMediaQueries } from '../../media';
import { DocumentOpenMenu } from '../../../components/documents/DocumentOpenMenu';
import { SPLIT_QUERY } from '../../../hooks/useSideDocument';

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function renderMenu(component?: 'div') {
  renderWithProviders(
    <Routes>
      <Route
        path="*"
        element={
          <>
            <DocumentOpenMenu roomId="room-1" documentId="doc-2" component={component}>
              <Link to="/rooms/room-1/documents/doc-2">Thorn</Link>
            </DocumentOpenMenu>
            <Where />
          </>
        }
      />
    </Routes>,
    { route: '/rooms/room-1/documents/doc-1' },
  );
  return userEvent.setup();
}

describe('DocumentOpenMenu (spec 37 Decision 2)', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('offers half screen, which opens the Document beside the page', async () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    const user = renderMenu();
    await user.click(screen.getByRole('link', { name: 'Thorn' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/rooms/room-1/documents/doc-1');
    await user.click(await screen.findByRole('menuitem', { name: 'Apri a metà schermo' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/rooms/room-1/documents/doc-1?side=doc-2');
  });

  it("offers the Document's page, and closes on a second click", async () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    const user = renderMenu('div');
    await user.click(screen.getByRole('link', { name: 'Thorn' }));
    expect(await screen.findByRole('menuitem', { name: 'Apri il Documento' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Thorn' }));
    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'Apri il Documento' })).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('link', { name: 'Thorn' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Apri il Documento' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/rooms/room-1/documents/doc-2');
  });

  it('leaves a Ctrl or Cmd click to the browser', () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    renderMenu();
    fireEvent.click(screen.getByRole('link', { name: 'Thorn' }), { ctrlKey: true });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('just follows the link on a phone', async () => {
    const user = renderMenu();
    await user.click(screen.getByRole('link', { name: 'Thorn' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/rooms/room-1/documents/doc-2');
  });
});
