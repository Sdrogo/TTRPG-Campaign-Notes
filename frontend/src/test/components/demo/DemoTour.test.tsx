import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDemoMode, setDemoMode } from '../../../lib/demo/demoMode';
import { TOUR_STEPS, setTourStep, tourStep } from '../../../lib/demo/tour';
import { renderWithProviders } from '../../utils';
import { DemoTour } from '../../../components/demo/DemoTour';

const START = TOUR_STEPS[0].path;
const scrollIntoView = vi.fn();

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

/** A page holding the element a step points at, laid out at `rect`. */
function render(route: string, rect: Partial<DOMRect> | null = { top: 100, left: 40, width: 200, height: 50, bottom: 150 }) {
  const result = renderWithProviders(
    <>
      <div data-tour="room">the Room</div>
      <div data-tour="document-card">hidden twin</div>
      <DemoTour />
      <Where />
    </>,
    { route },
  );
  const room = document.querySelector('[data-tour="room"]')!;
  room.scrollIntoView = scrollIntoView;
  if (rect) {
    vi.spyOn(room, 'getBoundingClientRect').mockReturnValue({ ...rect, right: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
  }
  return { ...result, user: userEvent.setup() };
}

const card = () => document.querySelector<HTMLElement>('.demo-tour-card');
const spot = () => document.querySelector<HTMLElement>('.demo-tour-spot')!;

beforeEach(() => {
  setDemoMode(true);
  scrollIntoView.mockReset();
});

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('DemoTour', () => {
  it('shows nothing while the tour is closed', () => {
    render(START);

    expect(card()).toBeNull();
  });

  it('lights the step element and explains it under it', async () => {
    setTourStep(0);
    render(START);

    expect(screen.getByRole('dialog', { name: 'Una Stanza è una campagna' })).toHaveTextContent('Tour della demo · 1 di 13');
    await waitFor(() => expect(spot()).toHaveAttribute('data-lit'));
    expect(spot().style.top).toBe('94px');
    expect(card()!.style.top).toBe(`${94 + 62 + 12}px`);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Indietro' })).not.toBeInTheDocument();
  });

  it('puts the card over an element low on the screen', async () => {
    setTourStep(0);
    render(START, { top: 600, left: 900, width: 100, height: 100, bottom: 700 });

    await waitFor(() => expect(spot()).toHaveAttribute('data-lit'));
    expect(card()!.style.bottom).toBe(`${window.innerHeight - 594 + 12}px`);
    expect(card()!.style.left).toBe(`${window.innerWidth - 340 - 16}px`);
  });

  it('docks the card at the bottom when the element fills the screen', async () => {
    setTourStep(0);
    render(START, { top: -50, left: 0, width: 800, height: 2000, bottom: 1950 });

    await waitFor(() => expect(spot()).toHaveAttribute('data-lit'));
    expect(spot().style.top).toBe('0px');
    expect(card()!.style.bottom).toBe('16px');
    expect(card()!.style.top).toBe('');
  });

  it('docks the card at the bottom on a phone', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    );
    setTourStep(0);
    render(START);

    await waitFor(() => expect(spot()).toHaveAttribute('data-lit'));
    expect(card()!.style.bottom).toBe('16px');
  });

  it('dims the page and centers the card while the element is not there', () => {
    setTourStep(2);
    render(START);

    expect(screen.getByRole('dialog', { name: 'I Documenti' })).toBeInTheDocument();
    expect(spot()).not.toHaveAttribute('data-lit');
    expect(card()!.style.top).toBe('50%');
  });

  it('follows the element when the page moves', async () => {
    setTourStep(0);
    render(START);
    await waitFor(() => expect(spot().style.top).toBe('94px'));

    vi.spyOn(document.querySelector('[data-tour="room"]')!, 'getBoundingClientRect').mockReturnValue({
      top: 300, left: 40, width: 200, height: 50, bottom: 350, right: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(spot().style.top).toBe('294px');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('shows the card alone on a page that is not the step', () => {
    setTourStep(0);
    render('/rooms/demo/maps');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(spot()).not.toHaveAttribute('data-lit');
  });

  it('moves on and back, opening each step page', async () => {
    setTourStep(2);
    const { user } = render(START);

    await user.click(screen.getByRole('button', { name: 'Avanti' }));
    expect(tourStep()).toBe(3);
    expect(screen.getByTestId('where')).toHaveTextContent(TOUR_STEPS[3].path);
    expect(screen.getByRole('dialog', { name: 'La pagina di un Documento' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(tourStep()).toBe(2);
    expect(screen.getByTestId('where')).toHaveTextContent(START);
  });

  it('closes on Skip and on Escape', async () => {
    setTourStep(1);
    const { user } = render(START);

    await user.click(screen.getByRole('button', { name: 'Salta il tour' }));
    expect(tourStep()).toBeNull();
    expect(card()).toBeNull();

    act(() => setTourStep(1));
    await user.keyboard('{Escape}');
    expect(tourStep()).toBeNull();
  });

  it('ends with a way to sign in or to keep exploring', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    setTourStep(TOUR_STEPS.length - 1);
    const { user } = render(START);

    expect(screen.getByRole('dialog', { name: 'Questo è Ex Libris' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continua a esplorare' }));
    expect(tourStep()).toBeNull();

    act(() => setTourStep(TOUR_STEPS.length - 1));
    await user.click(screen.getByRole('button', { name: 'Accedi e crea la tua Stanza' }));
    expect(tourStep()).toBeNull();
    expect(isDemoMode()).toBe(false);
    expect(assign).toHaveBeenCalledWith('/#sign-in');
  });
});
