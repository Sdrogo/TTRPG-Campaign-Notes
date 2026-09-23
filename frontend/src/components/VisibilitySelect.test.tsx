import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { VisibilitySelect } from './VisibilitySelect';

describe('VisibilitySelect', () => {
  it('shows the current level', () => {
    renderWithProviders(
      <VisibilitySelect subject="document" value="master" onChange={() => {}} label="Visibilità" />,
    );

    expect(screen.getByRole('combobox', { name: 'Visibilità' })).toHaveValue('Solo Master');
  });

  // The same four levels mean different things on a Document and a Comment
  // (VR-03), so the wording differs even though the values don't.
  it('words the options for a Document', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <VisibilitySelect subject="document" value="room" onChange={() => {}} label="Visibilità" />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Visibilità' }));

    expect(screen.getByText('Privato (Owner + Master)')).toBeInTheDocument();
  });

  it('words the options for a Comment', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <VisibilitySelect subject="comment" value="room" onChange={() => {}} label="Visibilità" />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Visibilità' }));

    expect(screen.getByText('Privato (tu + Master)')).toBeInTheDocument();
    expect(screen.getByText('Solo Master (e te)')).toBeInTheDocument();
  });

  it('reports the chosen level', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <VisibilitySelect subject="document" value="room" onChange={onChange} label="Visibilità" />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Visibilità' }));
    await user.click(screen.getByText('Solo Master'));

    expect(onChange).toHaveBeenCalledWith('master');
  });

  // Every Document has a level; there is no "unset", so all four are always
  // offered and `allowDeselect` is off.
  it('offers all four levels', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <VisibilitySelect subject="document" value="room" onChange={() => {}} label="Visibilità" />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Visibilità' }));

    expect(screen.getAllByRole('option')).toHaveLength(4);
  });
});
