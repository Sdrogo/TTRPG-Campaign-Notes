import { useState } from 'react';
import { Alert, Button, Group, Modal, MultiSelect, Select, Stack, Text, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  GROUP_MODES,
  MAX_CLOCKS_PER_GROUP,
  MAX_DECISIVE_LABEL_LENGTH,
  MAX_NAME_LENGTH,
} from '../../lib/clocks';
import type { Clock, GroupItem, GroupMode } from '../../types/clock';
import type { GroupInput } from '../../hooks/useClocks';

/** What the group dialog starts from: an existing group, or a new one (perhaps "Nuova svolta"). */
export interface GroupDraft {
  groupId: string | null;
  name: string;
  mode: GroupMode;
  items: GroupItem[];
}

/**
 * A group's dialog (spec 61 Decision 11), the Master's: its name, its mode
 * (with what it does), its clocks in the order picked (a clock in another
 * group moves here), and in a turn group each clock's decisive outcome
 * ("Svolta positiva"; empty means not decisive). Mounted while open.
 */
export function ClockGroupDialog({
  draft,
  clocks,
  submitting,
  error,
  onSubmit,
  onClose,
}: {
  draft: GroupDraft;
  /** The clocks a group can hold: the Room's, not proposed nor archived. */
  clocks: Clock[];
  submitting: boolean;
  error: string | null;
  onSubmit: (input: GroupInput) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(draft.name);
  const [mode, setMode] = useState<GroupMode>(draft.mode);
  const [items, setItems] = useState<GroupItem[]>(draft.items);
  const byId = new Map(clocks.map((clock) => [clock.id, clock]));

  return (
    <Modal
      opened
      onClose={onClose}
      closeOnClickOutside={false}
      title={draft.groupId ? t('clocks.groups.editTitle') : t('clocks.groups.create')}
      centered
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ groupId: draft.groupId, name, mode, items });
        }}
      >
        <Stack gap="sm">
          <TextInput
            spellCheck
            label={t('clocks.groups.name')}
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(event) => setName(event.currentTarget.value)}
            required
            data-autofocus
          />
          <Select
            label={t('clocks.groups.mode')}
            description={t(`clocks.groups.modeHint.${mode}`)}
            data={GROUP_MODES.map((value) => ({ value, label: t(`clocks.groupMode.${value}`) }))}
            value={mode}
            // No deselect, so never null.
            onChange={(value) => setMode(value as GroupMode)}
            allowDeselect={false}
          />
          <MultiSelect
            label={t('clocks.groups.clocks')}
            description={t('clocks.groups.clocksHint', { max: MAX_CLOCKS_PER_GROUP })}
            data={clocks.map((clock) => ({ value: clock.id, label: clock.name }))}
            value={items.map((item) => item.clockId)}
            onChange={(ids) =>
              setItems(
                ids.map(
                  (id) =>
                    items.find((item) => item.clockId === id) ?? { clockId: id, decisiveLabel: null },
                ),
              )
            }
            maxValues={MAX_CLOCKS_PER_GROUP}
            searchable
          />
          {mode === 'turn' && items.length > 0 && (
            <Stack gap={6}>
              <Text size="xs" c="dimmed">
                {t('clocks.groups.decisiveHint')}
              </Text>
              {items.map((item, index) => (
                <TextInput
                  key={item.clockId}
                  size="xs"
                  label={t('clocks.groups.decisive', { name: byId.get(item.clockId)?.name ?? '' })}
                  placeholder={t('clocks.groups.notDecisive')}
                  value={item.decisiveLabel ?? ''}
                  maxLength={MAX_DECISIVE_LABEL_LENGTH}
                  onChange={(event) => {
                    const decisiveLabel = event.currentTarget.value;
                    setItems((current) =>
                      current.map((other, at) => (at === index ? { ...other, decisiveLabel } : other)),
                    );
                  }}
                />
              ))}
            </Stack>
          )}
          {error && <Alert color="danger">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={submitting} disabled={!name.trim()}>
              {t('common.save')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
