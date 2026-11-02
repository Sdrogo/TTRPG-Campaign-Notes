import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SectionDescriptionEditor,
  SectionImageButton,
  SectionTitleEditor,
} from '../../../components/landing/SectionHeadingEditor';
import { apiFetch } from '../../../lib/apiClient';
import { toSection, type RawSection } from '../../../lib/landing';
import { rawSection } from '../../fixtures';
import { renderWithProviders } from '../../utils';

vi.mock('../../../lib/apiClient', () => ({ apiFetch: vi.fn() }));

const fetchMock = vi.mocked(apiFetch);
const untitled = toSection(rawSection({ title: null, description: 'Neon' }) as RawSection);
const tokyo = toSection(rawSection() as RawSection);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(rawSection({ title: 'Kyoto' }));
});

describe('the Section title editor (spec 60)', () => {
  it('saves a new title on Enter and ignores an empty or unchanged one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SectionTitleEditor roomId="room-1" section={tokyo} />);

    await user.click(screen.getByRole('button', { name: 'Rinomina la sezione Tokyo' }));
    await user.clear(screen.getByRole('textbox', { name: 'Titolo' }));
    await user.keyboard('   {Enter}');
    await user.click(screen.getByRole('button', { name: /Rinomina la sezione/ }));
    await user.keyboard('{Enter}');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Rinomina la sezione/ }));
    await user.clear(screen.getByRole('textbox', { name: 'Titolo' }));
    await user.type(screen.getByRole('textbox', { name: 'Titolo' }), 'Kyoto{Enter}');
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1', {
      method: 'PATCH',
      json: { title: 'Kyoto' },
    });
  });

  it('cancels on Escape and starts empty for an untitled page card', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SectionTitleEditor roomId="room-1" section={untitled} />);

    await user.click(screen.getByRole('button', { name: /Rinomina la sezione/ }));
    expect(screen.getByRole('textbox', { name: 'Titolo' })).toHaveValue('');
    await user.keyboard('a{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Titolo' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the Section description editor (spec 60)', () => {
  it('offers to add one, saves on blur and leaves an unchanged one alone', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SectionDescriptionEditor roomId="room-1" section={tokyo} />);

    await user.click(screen.getByRole('button', { name: 'Aggiungi una descrizione' }));
    await user.tab();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Aggiungi una descrizione' }));
    await user.type(screen.getByRole('textbox', { name: 'Descrizione' }), ' Neon ');
    await user.tab();
    expect(fetchMock).toHaveBeenCalledWith('/rooms/room-1/sections/section-1', {
      method: 'PATCH',
      json: { description: 'Neon' },
    });
  });

  it('starts from the description and cancels on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SectionDescriptionEditor roomId="room-1" section={untitled} />);

    await user.click(screen.getByRole('button', { name: 'Neon' }));
    expect(screen.getByRole('textbox', { name: 'Descrizione' })).toHaveValue('Neon');
    await user.keyboard('x');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Descrizione' })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the Section image button', () => {
  it('opens and closes "Modifica info"', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SectionImageButton roomId="room-1" section={tokyo} />);

    await user.click(screen.getByRole('button', { name: 'Modifica info' }));
    expect(screen.getByRole('dialog', { name: 'Modifica info' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
