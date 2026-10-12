import { useState } from 'react';
import { Button, Checkbox, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { MapGroup } from '../../types/map';
import { MapColorPicker } from './MapColorPicker';

/** The backend's limit on a group's title. */
const MAX_TITLE_LENGTH = 80;

interface GroupDialogProps {
  group: MapGroup;
  onSave: (patch: Partial<MapGroup>) => void;
  /** Removes the frame; its cards stay on the map. */
  onDelete: () => void;
  onClose: () => void;
}

/** Edits a group's title, color and strike (spec 28 Decision 7), or removes it. */
export function GroupDialog({ group, onSave, onDelete, onClose }: GroupDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(group.title ?? '');
  const [color, setColor] = useState(group.color);
  const [struck, setStruck] = useState(group.struck);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave({ title: title.trim() || null, color, struck });
  };

  return (
    <Modal opened onClose={onClose} title={t('maps.group.title')} centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <TextInput
            label={t('maps.group.name')}
            placeholder={t('maps.group.namePlaceholder')}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={MAX_TITLE_LENGTH}
            data-autofocus
          />
          <MapColorPicker value={color} onChange={setColor} />
          <Checkbox
            label={t('maps.struck')}
            checked={struck}
            onChange={(event) => setStruck(event.currentTarget.checked)}
          />
          <Group justify="space-between">
            <Button variant="subtle" color="red" onClick={onDelete}>
              {t('maps.group.remove')}
            </Button>
            <Button type="submit">{t('common.save')}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
