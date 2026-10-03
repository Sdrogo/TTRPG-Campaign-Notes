import { useState } from 'react';
import { Button, Checkbox, Select, Stack } from '@mantine/core';
import { findMember, memberDisplayName, memberOptionLabel } from '../lib/members';
import { AddPopover, InfoRow, PersonChip } from './DocumentInfoRow';
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
 * "Played by" (UC-21), a row of the info panel: the member who plays this
 * Document as their Character. Owners and the Master pick the player among
 * the Room's members from a "+", by default also making them an Owner so they
 * can edit their sheet. Hidden from other readers when nobody plays it.
 */
export function DocumentPlayer({ playedBy, members, canManage, onSet, onUnlink }: DocumentPlayerProps) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [addAsOwner, setAddAsOwner] = useState(true);

  if (!playedBy && !canManage) {
    return null;
  }

  const player = playedBy ? findMember(members, playedBy) : undefined;
  const name = memberDisplayName(player);
  const options = members
    .filter((m) => m.userId !== playedBy)
    .map((m) => ({ value: m.userId, label: memberOptionLabel(m, members) }));

  return (
    <InfoRow label={t('characters.playedBy')}>
      {playedBy && (
        <PersonChip
          member={player}
          name={name}
          onRemove={canManage ? onUnlink : undefined}
          removeLabel={t('characters.unlink', { name })}
        />
      )}
      {canManage && (
        <AddPopover label={t('characters.choosePlayer')} opened={picking} onChange={setPicking}>
          <Stack gap="xs">
            <Select
              placeholder={t('characters.choosePlayer')}
              aria-label={t('characters.choosePlayer')}
              data={options}
              value={playerId}
              onChange={setPlayerId}
              searchable
              // Inside the popover, or picking an option counts as a click
              // outside it and closes it.
              comboboxProps={{ withinPortal: false }}
            />
            <Checkbox
              label={t('characters.alsoOwner')}
              checked={addAsOwner}
              onChange={(event) => setAddAsOwner(event.currentTarget.checked)}
            />
            <Button
              variant="light"
              disabled={!playerId}
              style={{ alignSelf: 'flex-end' }}
              // Disabled on no selection, so this only ever runs with one.
              onClick={() => {
                onSet(playerId as string, addAsOwner);
                setPlayerId(null);
                setPicking(false);
              }}
            >
              {t('characters.setPlayer')}
            </Button>
          </Stack>
        </AddPopover>
      )}
    </InfoRow>
  );
}
