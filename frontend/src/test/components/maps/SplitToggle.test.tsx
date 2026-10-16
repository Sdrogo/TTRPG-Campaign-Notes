import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../utils';
import { matchMediaQueries } from '../../media';
import { SplitToggle } from '../../../components/maps/SplitToggle';
import { SPLIT_QUERY } from '../../../hooks/useSideDocument';

function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}

describe('SplitToggle (spec 37)', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('opens the pane with nothing picked, then closes it', async () => {
    restore = matchMediaQueries([SPLIT_QUERY]);
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <SplitToggle />
        <Where />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Mostra il pannello affiancato' }));
    expect(screen.getByTestId('where')).toHaveTextContent('?side=');
    await user.click(screen.getByRole('button', { name: 'Nascondi il pannello affiancato' }));
    expect(screen.getByTestId('where')).toHaveTextContent('');
  });

  it('is not offered on a phone', () => {
    renderWithProviders(<SplitToggle />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
