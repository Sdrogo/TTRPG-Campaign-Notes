import { useState } from 'react';
import { ActionIcon, Badge, Button, Checkbox, Group, Select, Stack, Text } from '@mantine/core';
import { TrashIcon } from '@phosphor-icons/react';
import { findMember, memberDisplayName, memberOptionLabel } from '../lib/members';
import { UserAvatar } from './UserAvatar';
import type { Member } from '../types/member';
import { useTranslation } from 'react-i18next';

interface DocumentPlayerProps {
  /** The member who plays the Document as their Character, or null. */
  playedBy: string | null;
  members: Member[];
  /** Owners and the Master (D-12) pick, change or unlink the player. */
  canManage: boolean;
  onSet: (userId: string, addAsOwner: boolean) => void;
  onUnlink: () => void;
}

/**
 * "Played by" (UC-21): the member who plays this Document as their Character.
 * Owners and the Master pick the player among the Room's members, by default
 * also making them an Owner so they can edit their sheet. Hidden from other
 * readers when nobody plays it.
 */
export function DocumentPlayer({ playedBy, members, canManage, onSet, onUnlink }: DocumentPlayerProps) {
  const { t } = useTranslation();
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [addAsOwner, setAddAsOwner] = useState(true);

  if (!playedBy && !canManage) {
    return null;
  }

  const player = playedBy ? findMember(members, playedBy) : undefined;
  const name = memberDisplayName(player);
  const options = members
    .filter((m) => m.userId !== playedBy)
    .map((m) => ({ value: m.userId, label: memberOptionLabel(m) }));

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        {t('characters.playedBy')}
      </Text>
      {playedBy && (
        <Group gap="xs">
          <Badge
            variant="outline"
            color="gray"
            tt="none"
            maw="100%"
            pl={3}
            leftSection={<UserAvatar user={player} size={16} />}
            rightSection={
              canManage ? (
                <ActionIcon
                  size="xs"
                  variant="transparent"
                  color="gray"
                  onClick={onUnlink}
                  aria-label={t('characters.unlink', { name })}
                >
                  <TrashIcon size={12} />
                </ActionIcon>
              ) : undefined
            }
          >
            {name}
          </Badge>
        </Group>
      )}
      {canManage && (
        <Group gap="xs" wrap="wrap">
          <Select
            placeholder={t('characters.choosePlayer')}
            aria-label={t('characters.choosePlayer')}
            data={options}
            value={playerId}
            onChange={setPlayerId}
            searchable
            style={{ flex: 1, minWidth: 200 }}
          />
          <Checkbox
            label={t('characters.alsoOwner')}
            checked={addAsOwner}
            onChange={(event) => setAddAsOwner(event.currentTarget.checked)}
          />
          <Button
            variant="light"
            disabled={!playerId}
            // Disabled on no selection, so this only ever runs with one.
            onClick={() => {
              onSet(playerId as string, addAsOwner);
              setPlayerId(null);
            }}
          >
            {t('characters.setPlayer')}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
