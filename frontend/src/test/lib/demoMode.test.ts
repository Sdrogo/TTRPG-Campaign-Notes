import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEMO_SESSION, DEMO_USER_ID, exitDemo, isDemoMode, setDemoMode } from '../../lib/demo/demoMode';

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('demoMode', () => {
  it('is off until turned on, for this tab only', () => {
    expect(isDemoMode()).toBe(false);

    expect(setDemoMode(true)).toBe(true);
    expect(isDemoMode()).toBe(true);
    expect(sessionStorage.getItem('exlibris.demo')).toBe('1');

    expect(setDemoMode(false)).toBe(false);
    expect(isDemoMode()).toBe(false);
  });

  it('stays off when site storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });

    expect(setDemoMode(true)).toBe(false);
    expect(isDemoMode()).toBe(false);
  });

  it('hands out the sample Room Master as the session', () => {
    expect(DEMO_SESSION.user.id).toBe(DEMO_USER_ID);
  });

  it('leaves with a full page load', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    setDemoMode(true);

    exitDemo('/#sign-in');

    expect(isDemoMode()).toBe(false);
    expect(assign).toHaveBeenCalledWith('/#sign-in');
  });
});
