import { Button } from '@mantine/core';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import { ImageUrlPopover } from './ImageUrlPopover';

function setup(onAddUrl = vi.fn()) {
  const user = userEvent.setup();
  renderWithProviders(
    <ImageUrlPopover onAddUrl={onAddUrl}>
      {(toggle) => <Button onClick={toggle}>Da URL</Button>}
    </ImageUrlPopover>,
  );
  return { user, onAddUrl, open: () => user.click(screen.getByRole('button', { name: 'Da URL' })) };
}

const urlField = () => screen.getByLabelText("URL dell'immagine");

describe('ImageUrlPopover', () => {
  it('stays closed until the target is clicked', () => {
    setup();

    expect(screen.queryByLabelText("URL dell'immagine")).not.toBeInTheDocument();
  });

  it('opens on the target it was given', async () => {
    const { open } = setup();

    await open();

    expect(urlField()).toBeInTheDocument();
  });

  it('submits a valid URL', async () => {
    const { user, onAddUrl, open } = setup();
    await open();

    await user.type(urlField(), 'https://example.com/map.png');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));

    expect(onAddUrl).toHaveBeenCalledWith('https://example.com/map.png');
  });

  it('submits on Enter too', async () => {
    const { user, onAddUrl, open } = setup();
    await open();

    await user.type(urlField(), 'https://example.com/map.png{Enter}');

    expect(onAddUrl).toHaveBeenCalledWith('https://example.com/map.png');
  });

  it('trims surrounding whitespace off a pasted URL', async () => {
    const { user, onAddUrl, open } = setup();
    await open();

    await user.type(urlField(), '  https://example.com/map.png  {Enter}');

    expect(onAddUrl).toHaveBeenCalledWith('https://example.com/map.png');
  });

  // The backend only fetches http(s) (its SSRF guard rejects the rest), so
  // the form says so rather than sending a request that will fail.
  it('rejects a non-http(s) URL', async () => {
    const { user, onAddUrl, open } = setup();
    await open();

    await user.type(urlField(), 'ftp://example.com/map.png');

    expect(screen.getByText('Inserisci un URL http(s) valido')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aggiungi' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(onAddUrl).not.toHaveBeenCalled();
  });

  it('keeps the submit button disabled while the field is empty', async () => {
    const { open } = setup();
    await open();

    expect(screen.getByRole('button', { name: 'Aggiungi' })).toBeDisabled();
  });

  it('closes and clears after a successful submit', async () => {
    const { user, open } = setup();
    await open();
    await user.type(urlField(), 'https://example.com/map.png{Enter}');

    expect(screen.queryByLabelText("URL dell'immagine")).not.toBeInTheDocument();

    await open();
    expect(urlField()).toHaveValue('');
  });

  it('uses a custom submit label when one is given', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ImageUrlPopover onAddUrl={vi.fn()} submitLabel="Importa">
        {(toggle) => <Button onClick={toggle}>Da URL</Button>}
      </ImageUrlPopover>,
    );

    await user.click(screen.getByRole('button', { name: 'Da URL' }));

    expect(screen.getByRole('button', { name: 'Importa' })).toBeInTheDocument();
  });
});
