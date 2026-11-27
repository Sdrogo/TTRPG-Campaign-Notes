import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../utils';
import { GlossarySection } from '../../../components/account/GlossarySection';

afterEach(() => window.localStorage.clear());

describe('GlossarySection', () => {
  it('switches the highlighting of Glossary terms off and on for this device', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GlossarySection />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toBeChecked();

    await user.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(window.localStorage.getItem('ttrpg.glossaryHighlight')).toBe('off');
  });
});
