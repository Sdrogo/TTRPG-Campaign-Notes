import { useState } from 'react';
import {
  Autocomplete,
  Button,
  Checkbox,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Input,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { ArrowDirection, MapArrow } from '../../types/map';
import { MapColorPicker } from './MapColorPicker';

/** The longest label an arrow takes (the backend's limit). */
const MAX_LABEL_LENGTH = 60;

interface ArrowDialogProps {
  arrow: MapArrow;
  /** The names of the two ends, so the labels say which way they read. */
  fromName: string;
  toName: string;
  /** The labels already used in the Room that the viewer sees (Decision 5). */
  suggestions: string[];
  /** Only the Master marks an arrow Master only. */
  isMaster: boolean;
  onSave: (patch: Partial<MapArrow>) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Edits an arrow (spec 28 Decision 5): its direction, its label (one per
 * direction on a two-way arrow), color and, for the Master, whether only
 * Masters see it. Mounted per arrow, so it starts from the arrow's values.
 */
export function ArrowDialog({
  arrow,
  fromName,
  toName,
  suggestions,
  isMaster,
  onSave,
  onDelete,
  onClose,
}: ArrowDialogProps) {
  const { t } = useTranslation();
  const [direction, setDirection] = useState<ArrowDirection>(arrow.direction);
  const [label, setLabel] = useState(arrow.label ?? '');
  const [reverseLabel, setReverseLabel] = useState(arrow.reverseLabel ?? '');
  const [color, setColor] = useState(arrow.color);
  const [masterOnly, setMasterOnly] = useState(arrow.masterOnly);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave({
      direction,
      label: label.trim() || null,
      reverseLabel: direction === 'both' ? reverseLabel.trim() || null : null,
      color,
      masterOnly,
    });
  };

  return (
    <Modal opened onClose={onClose} title={t('maps.arrow.title')} centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          <Input.Wrapper label={t('maps.arrow.direction')}>
            <SegmentedControl
              fullWidth
              mt={4}
              value={direction}
              onChange={(value) => setDirection(value as ArrowDirection)}
              data={[
                { value: 'forward', label: t('maps.arrow.forward') },
                { value: 'both', label: t('maps.arrow.both') },
                { value: 'none', label: t('maps.arrow.none') },
              ]}
            />
          </Input.Wrapper>
          <Autocomplete
            label={
              direction === 'both'
                ? t('maps.arrow.labelTowards', { name: toName })
                : t('maps.arrow.label')
            }
            value={label}
            onChange={setLabel}
            data={suggestions}
            maxLength={MAX_LABEL_LENGTH}
            data-autofocus
          />
          {direction === 'both' && (
            <Autocomplete
              label={t('maps.arrow.labelTowards', { name: fromName })}
              value={reverseLabel}
              onChange={setReverseLabel}
              data={suggestions}
              maxLength={MAX_LABEL_LENGTH}
            />
          )}
          <MapColorPicker value={color} onChange={setColor} />
          {isMaster && (
            <Checkbox
              label={t('maps.masterOnlyArrow')}
              checked={masterOnly}
              onChange={(event) => setMasterOnly(event.currentTarget.checked)}
            />
          )}
          <Group justify="space-between">
            <Button variant="subtle" color="red" onClick={onDelete}>
              {t('maps.arrow.delete')}
            </Button>
            <Button type="submit">{t('common.save')}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
