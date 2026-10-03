import { useState } from 'react';
import { Button, Select, Stack } from '@mantine/core';
import { findMember, memberDisplayName, memberOptionLabel } from '../lib/members';
import { AddPopover, InfoRow, PersonChip } from './DocumentInfoRow';
import type { Member } from '../types/member';
import { useTranslation } from 'react-i18next';

interface DocumentOwnersProps {
  ownerIds: string[];
  members: Member[];
  canManage: boolean;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
}

/**
 * A Document's explicit Owners, a row of the info panel. When `canManage`
 * (Owners and the Master, D-12) each can be removed, and a "+" opens a picker
 * to add a member.
 */
export function DocumentOwners({ ownerIds, members, canManage, onAdd, onRemove }: DocumentOwnersProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [addOwnerId, setAddOwnerId] = useState<string | null>(null);

  const ownerOptions = members
    .filter((m) => !ownerIds.includes(m.userId))
    .map((m) => ({ value: m.userId, label: memberOptionLabel(m, members) }));

  return (
    <InfoRow label={t('documents.owners')}>
      {ownerIds.map((ownerId) => {
        const owner = findMember(members, ownerId);
        const name = memberDisplayName(owner);
        return (
          <PersonChip
            key={ownerId}
            member={owner}
            name={name}
            onRemove={canManage ? () => onRemove(ownerId) : undefined}
            removeLabel={t('documents.removeOwner', { name })}
          />
        );
      })}
      {canManage && (
        <AddPopover label={t('documents.addOwner')} opened={adding} onChange={setAdding}>
          <Stack gap="xs">
            <Select
              placeholder={t('documents.addOwner')}
              aria-label={t('documents.addOwner')}
              data={ownerOptions}
              value={addOwnerId}
              onChange={setAddOwnerId}
              searchable
              // Inside the popover, or picking an option counts as a click
              // outside it and closes it.
              comboboxProps={{ withinPortal: false }}
            />
            <Button
              variant="light"
              disabled={!addOwnerId}
              style={{ alignSelf: 'flex-end' }}
              // Disabled on no selection, so this only ever runs with one.
              onClick={() => {
                onAdd(addOwnerId as string);
                setAddOwnerId(null);
                setAdding(false);
              }}
            >
              {t('common.add')}
            </Button>
          </Stack>
        </AddPopover>
      )}
    </InfoRow>
  );
}
