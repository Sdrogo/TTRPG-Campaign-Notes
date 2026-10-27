import { act as reactAct, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimerBar } from '../../../components/sessionZero/TimerBar';
import { boardWrites } from '../../../lib/sessionZero';
import { renderBoard } from './harness';

const NOW = Date.parse('2026-10-27T10:00:00Z');
const at = (ms: number) => new Date(ms).toISOString();

function running(secondsToGo: number) {
  return { state: 'running', duration_s: 600, ends_at: at(NOW + secondsToGo * 1000), remaining_s: null, now: at(NOW) };
}

const paused = { state: 'paused', duration_s: 600, ends_at: null, remaining_s: 125, now: at(NOW) };

afterEach(() => {
  vi.useRealTimers();
});

describe('TimerBar', () => {
  it('shows nothing to a Player while there is no timer', () => {
    const { container } = { container: document.body };
    renderBoard(<TimerBar readAtMs={NOW} />);
    expect(container.querySelector('[role="timer"]')).toBeNull();
  });

  // Decision 4: the time left counts down here, from the server's end time.
  it('counts down a running timer for everyone', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(NOW);
    renderBoard(<TimerBar readAtMs={NOW} />, { board: { timer: running(600) } });
    expect(screen.getByRole('timer', { name: 'Timer' })).toHaveTextContent('10:00');
    reactAct(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('timer')).toHaveTextContent('9:58');
    expect(screen.queryByRole('button', { name: 'Gestisci il timer' })).not.toBeInTheDocument();
  });

  it("says time's up at zero, and lets the Master stop it but not pause it", async () => {
    const { act, user } = renderBoard(<TimerBar readAtMs={Date.now()} />, {
      board: { can_manage: true, timer: { ...running(0), ends_at: at(NOW - 5000) } },
    });
    expect(screen.getByRole('timer')).toHaveTextContent('Tempo scaduto');
    await user.click(screen.getByRole('button', { name: 'Gestisci il timer' }));
    expect(screen.queryByRole('menuitem', { name: 'Metti in pausa' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: 'Ferma e azzera' }));
    expect(act).toHaveBeenCalledWith(boardWrites.timer('stop'));
  });

  it('lets the Master pause a running timer', async () => {
    const { act, user } = renderBoard(<TimerBar readAtMs={Date.now()} />, {
      board: { can_manage: true, timer: { ...running(0), ends_at: at(Date.now() + 300_000), now: at(Date.now()) } },
    });
    await user.click(screen.getByRole('button', { name: 'Gestisci il timer' }));
    expect(screen.queryByRole('menuitem', { name: 'Riprendi' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', { name: 'Metti in pausa' }));
    expect(act).toHaveBeenCalledWith(boardWrites.timer('pause'));
  });

  it('shows a paused timer frozen, which the Master resumes', async () => {
    const { act, user } = renderBoard(<TimerBar readAtMs={NOW} />, { board: { can_manage: true, timer: paused } });
    expect(screen.getByRole('timer')).toHaveTextContent('2:05');
    expect(screen.getByRole('timer')).toHaveTextContent('In pausa');
    await user.click(screen.getByRole('button', { name: 'Gestisci il timer' }));
    expect(screen.queryByRole('menuitem', { name: 'Metti in pausa' })).not.toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: 'Ferma e azzera' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Riprendi' }));
    expect(act).toHaveBeenCalledWith(boardWrites.timer('resume'));
  });

  it('lets the Master start a timer of a preset length', async () => {
    const { act, user } = renderBoard(<TimerBar readAtMs={NOW} />, {
      board: { can_manage: true, timer: { ...paused, state: 'stopped', remaining_s: null } },
    });
    expect(screen.getByRole('timer')).toHaveTextContent('Nessun timer');
    await user.click(screen.getByRole('button', { name: 'Gestisci il timer' }));
    expect(screen.queryByRole('menuitem', { name: 'Ferma e azzera' })).not.toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: '5 minuti' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '15 minuti' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: '10 minuti' }));
    expect(act).toHaveBeenCalledWith(boardWrites.timer('start', 10));
  });

  it('lets the Master start a timer of their own length, 1 to 60 minutes', async () => {
    const { act, user } = renderBoard(<TimerBar readAtMs={NOW} />, { board: { can_manage: true } });
    const open = async () => {
      await user.click(screen.getByRole('button', { name: 'Gestisci il timer' }));
      await user.click(await screen.findByRole('menuitem', { name: 'Durata personalizzata' }));
      return screen.findByRole('textbox', { name: 'Minuti' });
    };

    await open();
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(act).not.toHaveBeenCalled();

    const minutes = await open();
    await user.clear(minutes);
    expect(screen.getByRole('button', { name: 'Avvia' })).toBeDisabled();
    await user.type(minutes, '25');
    await user.click(screen.getByRole('button', { name: 'Avvia' }));
    expect(act).toHaveBeenCalledWith(boardWrites.timer('start', 25));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers the Master no timer menu while previewing the Room', () => {
    renderBoard(<TimerBar readAtMs={NOW} />, { board: { can_manage: true, timer: paused }, writable: false });
    expect(screen.getByRole('timer')).toHaveTextContent('2:05');
    expect(screen.queryByRole('button', { name: 'Gestisci il timer' })).not.toBeInTheDocument();
  });
});
