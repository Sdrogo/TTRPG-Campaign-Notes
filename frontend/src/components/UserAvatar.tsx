import { Avatar, type AvatarProps } from '@mantine/core';

interface UserAvatarProps extends Omit<AvatarProps, 'name' | 'children'> {
  // The user's display name (their email for now); initials are derived from it.
  name: string;
}

export function UserAvatar({ name, ...props }: UserAvatarProps) {
  return <Avatar {...props} name={name} color="accent" variant="light" alt={name} />;
}
