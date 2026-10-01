import { Avatar, type AvatarProps } from '@mantine/core';
import type { Character } from '../types/character';

interface CharacterAvatarProps extends Omit<AvatarProps, 'name' | 'children' | 'src' | 'alt'> {
  character: Character;
}

/**
 * A Character's picture: its Document's leading image, or the initials of its
 * name. Rounded square rather than a circle, so it never reads as a user
 * avatar (ui-context.md: circles are people).
 */
export function CharacterAvatar({ character, ...props }: CharacterAvatarProps) {
  return (
    <Avatar
      {...props}
      radius="md"
      src={character.imageUrl}
      name={character.name}
      alt={character.name}
      color="accent"
      variant="light"
    />
  );
}
