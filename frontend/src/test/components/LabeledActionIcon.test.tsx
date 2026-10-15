import { describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../utils';
import { LabeledActionIcon } from '../../components/LabeledActionIcon';

describe('LabeledActionIcon', () => {
  it('shows its aria-label as a tooltip when hovered', async () => {
    renderWithProviders(<LabeledActionIcon aria-label="Do the thing">x</LabeledActionIcon>);
    await userEvent.setup().hover(screen.getByRole('button', { name: 'Do the thing' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Do the thing');
  });
});
