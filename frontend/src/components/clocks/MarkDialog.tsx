import { useState } from 'react';
import { Button, Group, Modal, NumberInput, Select, Stack, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { MAX_NOTE_LENGTH, usableKinds } from '../../lib/clocks';
import type { Clock, MarkKind } from '../../types/clock';

/**
 * "Segna…" (spec 61 Decision 7): N segments at once, from one to the free
 * ones, with an optional note and, when the Room has mark kinds this member
 * may use, the kind (the first one by default, Decision 8).
 */
export function MarkDialog({
  clock,
  kinds,
  isMaster,
  onSubmit,
  onClose,
}: {
  clock: Clock;
  kinds: MarkKind[];
  isMaster: boolean;
  onSubmit: (input: { delta: number; kindId: string | null; note: string }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const free = clock.segments - clock.filled;
  const choices = usableKinds(kinds, isMaster);
  const [delta, setDelta] = useState(1);
  const [kindId, setKindId] = useState<string | null>(choices[0]?.id ?? null);
  const [note, setNote] = useState('');

  return (
    <Modal opened onClose={onClose} closeOnClickOutside={false} title={t('clocks.markDialog.title', { name: clock.name })} centered>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ delta, kindId, note });
        }}
      >
        <Stack gap="sm">
          <NumberInput
            label={t('clocks.markDialog.count')}
            description={t('clocks.markDialog.countHint', { count: free })}
            value={delta}
            min={1}
            max={free}
            allowDecimal={false}
            clampBehavior="strict"
            onChange={(value) => typeof value === 'number' && setDelta(value)}
            data-autofocus
          />
          {choices.length > 0 && (
            <Select
              label={t('clocks.markDialog.kind')}
              data={choices.map((kind) => ({ value: kind.id, label: kind.name }))}
              value={kindId}
              onChange={setKindId}
              allowDeselect={false}
            />
          )}
          <TextInput
            spellCheck
            label={t('clocks.markDialog.note')}
            placeholder={t('clocks.markDialog.notePlaceholder')}
            value={note}
            maxLength={MAX_NOTE_LENGTH}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="subtle" color="gray" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={free < 1}>
              {t('clocks.markDialog.submit', { count: delta })}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
