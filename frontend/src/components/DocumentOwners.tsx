import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Select, Stack, Text } from '@mantine/core';
import { TrashIcon } from '@phosphor-icons/react';
import { findMember, memberDisplayName, memberOptionLabel } from '../lib/members';
import { UserAvatar } from './UserAvatar';
import type { Member } from '../types/member';

interface DocumentOwnersProps {
  ownerIds: string[];
  members: Member[];
  canManage: boolean;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
}

/**
 * A Document's explicit Owners, with controls to add a member or remove an
 * Owner when `canManage` (Owners and the Master, D-12).
 */
export function DocumentOwners({ ownerIds, members, canManage, onAdd, onRemove }: DocumentOwnersProps) {
  const [addOwnerId, setAddOwnerId] = useState<string | null>(null);

  const ownerOptions = members
    .filter((m) => !ownerIds.includes(m.userId))
    .map((m) => ({ value: m.userId, label: memberOptionLabel(m) }));

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Owner
      </Text>
      <Group gap="xs">
        {ownerIds.map((ownerId) => {
          const owner = findMember(members, ownerId);
          const name = memberDisplayName(owner);
          return (
            <Badge
              key={ownerId}
              variant="outline"
              color="gray"
              tt="none"
              maw="100%"
              pl={3}
              leftSection={<UserAvatar user={owner} size={16} />}
              rightSection={
                canManage ? (
                  <ActionIcon
                    size="xs"
                    variant="transparent"
                    color="gray"
                    onClick={() => onRemove(ownerId)}
                    aria-label={`Rimuovi Owner ${name}`}
                  >
                    <TrashIcon size={12} />
                  </ActionIcon>
                ) : undefined
              }
            >
              {name}
            </Badge>
          );
        })}
      </Group>
      {canManage && (
        <Group gap="xs" wrap="wrap">
          <Select
            placeholder="Aggiungi Owner"
            data={ownerOptions}
            value={addOwnerId}
            onChange={setAddOwnerId}
            searchable
            style={{ flex: 1, minWidth: 200 }}
          />
          <Button
            variant="light"
            disabled={!addOwnerId}
            onClick={() => {
              if (addOwnerId) {
                onAdd(addOwnerId);
                setAddOwnerId(null);
              }
            }}
          >
            Aggiungi
          </Button>
        </Group>
      )}
    </Stack>
  );
}
