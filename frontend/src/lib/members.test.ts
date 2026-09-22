import { describe, expect, it } from 'vitest';
import { UNKNOWN_USER_LABEL, memberDisplayName, memberOptionLabel } from './members';
import type { Member } from '../types/member';

const member = (userId: string, email: string | null): Member => ({
  userId,
  email,
  role: 'player',
  isAdmin: false,
});

describe('memberOptionLabel', () => {
  it('uses the email when there is one', () => {
    expect(memberOptionLabel(member('11111111-aaaa', 'a@example.com'))).toBe('a@example.com');
  });

  it('tells apart two members with no email', () => {
    const first = memberOptionLabel(member('11111111-aaaa', null));
    const second = memberOptionLabel(member('22222222-bbbb', null));
    expect(first).not.toBe(second);
    expect(first).toContain(UNKNOWN_USER_LABEL);
  });

  it('leaves the plain display name unchanged', () => {
    expect(memberDisplayName(member('11111111-aaaa', null))).toBe(UNKNOWN_USER_LABEL);
  });
});
