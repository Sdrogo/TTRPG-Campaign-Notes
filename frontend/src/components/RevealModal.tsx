import { useState } from 'react';
import { Button, Checkbox, Group, Modal, Radio, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { MemberMultiSelect } from './MemberMultiSelect';
import { memberDisplayName } from '../lib/members';
import { NO_AUDIENCE, revealWidens, type ContentAudience } from '../lib/reveal';
import type { Member } from '../types/member';
import type { Note } from '../types/note';
import type { RevealAudience } from '../types/reveal';

interface RevealModalProps {
  /** What is revealed, for the title. */
  name: string;
  /** Every member of the Room. */
  members: Member[];
  /** The content's own audience now. */
  current: ContentAudience;
  /** The members who can be chosen: those who don't see it now. */
  pickable: Member[];
  /** The members a Reveal to `audience` would let in. */
  gains: (audience: RevealAudience) => Member[];
  /**
   * For a Document: its Notes that some member gaining it still wouldn't see,
   * offered to reveal in the same step (spec 22 Decision 2).
   */
  hiddenNotes?: (gains: Member[]) => Note[];
  loading: boolean;
  onConfirm: (audience: RevealAudience, noteIds: string[]) => void;
  onClose: () => void;
}

/**
 * The Master's Reveal dialog (spec 22 Decisions 1 and 2): the whole Room or
 * chosen players added to who already sees the content, who gains access,
 * and, for a Document, its Notes that stay hidden from them, each unchecked.
 * Confirming is allowed only when the Reveal lets someone new in; Cancel
 * changes nothing. Mounted only while open, so it always starts empty.
 */
export function RevealModal({
  name,
  members,
  current,
  pickable,
  gains,
  hiddenNotes,
  loading,
  onConfirm,
  onClose,
}: RevealModalProps) {
  const { t } = useTranslation();
  const [audience, setAudience] = useState<RevealAudience>(NO_AUDIENCE);
  const [noteIds, setNoteIds] = useState<string[]>([]);

  const gained = gains(audience);
  const notes = hiddenNotes ? hiddenNotes(gained) : [];
  const widens = revealWidens(current, audience, members);

  const confirm = () => {
    // A Note checked before the audience changed may no longer be offered.
    const offered = new Set(notes.map((note) => note.id));
    onConfirm(audience, noteIds.filter((id) => offered.has(id)));
  };

  return (
    <Modal opened onClose={onClose} title={t('reveal.modalTitle', { name })} centered>
      <Stack gap="md">
        <Radio.Group
          label={t('reveal.audienceLabel')}
          value={audience.toRoom ? 'room' : 'chosen'}
          onChange={(value) => setAudience({ ...audience, toRoom: value === 'room' })}
        >
          <Stack gap={6} mt={6}>
            <Radio value="room" label={t('reveal.toRoom')} />
            <Radio value="chosen" label={t('reveal.toChosen')} />
          </Stack>
        </Radio.Group>

        {!audience.toRoom &&
          (pickable.length > 0 ? (
            <MemberMultiSelect
              label={t('reveal.chosenLabel')}
              placeholder={t('reveal.chosenPlaceholder')}
              members={pickable}
              value={audience.userIds}
              onChange={(userIds) => setAudience({ ...audience, userIds })}
              comboboxProps={{ withinPortal: false }}
            />
          ) : (
            <Text size="sm" c="dimmed">
              {t('reveal.noOneToPick')}
            </Text>
          ))}

        {widens && (
          <Text size="sm">
            {gained.length > 0
              ? t('reveal.gains', { names: gained.map(memberDisplayName).join(', ') })
              : t('reveal.noGains')}
          </Text>
        )}

        {notes.length > 0 && (
          <Checkbox.Group
            label={t('reveal.notesLabel')}
            description={t('reveal.notesDescription')}
            value={noteIds}
            onChange={setNoteIds}
          >
            <Stack gap={4} mt={6}>
              {notes.map((note) => (
                <Checkbox key={note.id} value={note.id} label={note.title} />
              ))}
            </Stack>
          </Checkbox.Group>
        )}

        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button color="orange" loading={loading} disabled={!widens} onClick={confirm}>
            {t('reveal.confirm')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
