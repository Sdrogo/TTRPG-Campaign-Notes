import { Avatar, type AvatarProps } from '@mantine/core';
import { userDisplayName } from '../lib/members';
import type { UserIdentity } from '../types/profile';

interface UserAvatarProps extends Omit<AvatarProps, 'name' | 'children' | 'src' | 'alt'> {
  // Undefined while the user's profile is loading or unknown: initials of
  // the "unknown user" label are shown.
  user: UserIdentity | undefined;
}

// Always a circle (ui-context.md). Shows the user's avatar, or their initials
// (from their chosen name, else email) when they have none or it fails to load.
export function UserAvatar({ user, ...props }: UserAvatarProps) {
  const name = userDisplayName(user);
  return (
    <Avatar
      {...props}
      radius="50%"
      src={user?.avatarUrl ?? null}
      name={name}
      alt={name}
      color="accent"
      variant="light"
    />
  );
}
