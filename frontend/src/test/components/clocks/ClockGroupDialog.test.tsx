import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { toClock } from '../../../lib/clocks';
import { rawClock } from '../../clockFixtures';
import { renderWithProviders } from '../../utils';
import { ClockGroupDialog, type GroupDraft } from '../../../components/clocks/ClockGroupDialog';

const clocks = [toClock(rawClock({ id: 'a', name: 'Fuga' })), toClock(rawClock({ id: 'b', name: 'Accerchiati' }))];

function render(draft: GroupDraft = { groupId: null, name: '', mode: 'free', items: [] }, error: string | null = null) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <ClockGroupDialog draft={draft} clocks={clocks} submitting={false} error={error} onSubmit={onSubmit} onClose={onClose} />,
  );
  return { user: userEvent.setup(), onSubmit, onClose };
}

describe('ClockGroupDialog', { timeout: 20_000 }, () => {
  it('makes a turn group with a decisive clock', async () => {
    const { user, onSubmit } = render();
    expect(screen.getByRole('dialog', { name: 'Nuovo gruppo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salva' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Nome del gruppo' }), 'La notte');
    await user.click(screen.getByRole('combobox', { name: 'Modo' }));
    await user.click(screen.getByRole('option', { name: 'Svolta' }));
    expect(screen.getByText(/Alcuni clock sono decisivi/)).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Clock del gruppo' }));
    await user.click(screen.getByRole('option', { name: 'Accerchiati' }));
    await user.click(screen.getByRole('option', { name: 'Fuga' }));
    await user.type(screen.getByRole('textbox', { name: 'Esito di «Fuga»' }), 'Fuori!');
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSubmit).toHaveBeenCalledWith({
      groupId: null,
      name: 'La notte',
      mode: 'turn',
      items: [
        { clockId: 'b', decisiveLabel: null },
        { clockId: 'a', decisiveLabel: 'Fuori!' },
      ],
    });
  });

  it('edits a group, keeping the labels of the clocks it keeps, and shows an error', async () => {
    const { user, onSubmit, onClose } = render(
      { groupId: 'g', name: 'Fuga', mode: 'turn', items: [{ clockId: 'a', decisiveLabel: 'Vinta' }, { clockId: 'gone', decisiveLabel: null }] },
      'Troppi clock',
    );
    expect(screen.getByRole('dialog', { name: 'Modifica gruppo' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Troppi clock');
    expect(screen.getByRole('textbox', { name: 'Esito di «»' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: 'Clock del gruppo' }));
    await user.click(screen.getByRole('option', { name: 'Accerchiati' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(onSubmit.mock.calls[0][0].items[0]).toEqual({ clockId: 'a', decisiveLabel: 'Vinta' });
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onClose).toHaveBeenCalled();
  });
});
