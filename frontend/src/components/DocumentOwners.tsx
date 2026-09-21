import { useState } from 'react';
import { ActionIcon, Badge, Button, Group, Select, Stack, Text } from '@mantine/core';
import { TrashIcon } from '@phosphor-icons/react';
import { displayNameFor, memberDisplayName } from '../lib/members';
import type { Member } from '../types/member';

interface DocumentOwnersProps {
  ownerIds: string[];
  members: Member[];
  canManage: boolean;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
}

export function DocumentOwners({ ownerIds, members, canManage, onAdd, onRemove }: DocumentOwnersProps) {
  const [addOwnerId, setAddOwnerId] = useState<string | null>(null);

  const ownerOptions = members
    .filter((m) => !ownerIds.includes(m.userId))
    .map((m) => ({ value: m.userId, label: memberDisplayName(m) }));

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm">
        Owner
      </Text>
      <Group gap="xs">
        {ownerIds.map((ownerId) => {
          const name = displayNameFor(members, ownerId);
          return (
            <Badge
              key={ownerId}
              variant="outline"
              color="gray"
              tt="none"
              maw="100%"
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
