import { useState } from 'react';
import { ActionIcon, Group, Text, Textarea, TextInput, UnstyledButton } from '@mantine/core';
import { ImageIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { SectionInfoModal } from './SectionInfoModal';
import { useUpdateSection } from '../../hooks/useLanding';
import { sectionTitle } from '../../lib/landingText';
import { notifyError } from '../../lib/notify';
import type { LandingSection } from '../../types/landing';

/**
 * A custom Section's title, edited in place in edit mode (spec 60 Decision
 * 10): click, type, Enter saves, Esc cancels; an empty title is refused.
 */
export function SectionTitleEditor({ roomId, section }: { roomId: string; section: LandingSection }) {
  const { t } = useTranslation();
  const update = useUpdateSection(roomId);
  const [draft, setDraft] = useState<string | null>(null);
  const title = sectionTitle(section);
  if (draft !== null) {
    const save = () => {
      const clean = draft.trim();
      setDraft(null);
      if (clean && clean !== section.title) update.mutate({ id: section.id, title: clean }, { onError: notifyError });
    };
    return (
      <TextInput
        autoFocus
        aria-label={t('roomLanding.edit.titleLabel')}
        value={draft}
        maxLength={100}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
          if (event.key === 'Escape') setDraft(null);
        }}
        classNames={{ input: 'section-title-input' }}
        w={{ base: '100%', sm: 420 }}
      />
    );
  }
  return (
    <UnstyledButton
      onClick={() => setDraft(section.title ?? '')}
      aria-label={t('roomLanding.edit.renameSection', { name: title })}
      className="room-landing-heading"
    >
      <Group gap={6} wrap="nowrap">
        <span>{title}</span>
        <PencilSimpleIcon size={18} aria-hidden="true" />
      </Group>
    </UnstyledButton>
  );
}

/**
 * A custom Section's description in edit mode (spec 60 Decision 10): the
 * text, or "Aggiungi una descrizione" when empty; a click opens a textarea
 * saved on blur (Esc cancels).
 */
export function SectionDescriptionEditor({ roomId, section }: { roomId: string; section: LandingSection }) {
  const { t } = useTranslation();
  const update = useUpdateSection(roomId);
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    const save = () => {
      const next = draft.trim();
      setDraft(null);
      if (next !== section.description) update.mutate({ id: section.id, description: next }, { onError: notifyError });
    };
    return (
      <Textarea
        autoFocus
        aria-label={t('common.description')}
        value={draft}
        maxLength={2000}
        autosize
        minRows={2}
        maxRows={8}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDraft(null);
        }}
        maw={720}
        w="100%"
      />
    );
  }
  return (
    <UnstyledButton onClick={() => setDraft(section.description)} className="room-landing-heading" maw={720}>
      <Group gap={6} wrap="nowrap" align="flex-start">
        <Text c="dimmed" size="sm" style={{ whiteSpace: 'pre-line' }}>
          {section.description || t('roomLanding.edit.addDescription')}
        </Text>
        <PencilSimpleIcon size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }} />
      </Group>
    </UnstyledButton>
  );
}

/** Beside the title in edit mode: the Section's image (and its other fields) in "Modifica info". */
export function SectionImageButton({ roomId, section }: { roomId: string; section: LandingSection }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => setOpen(true)} aria-label={t('roomLanding.edit.info')} title={t('roomLanding.edit.info')}>
        <ImageIcon size={20} />
      </ActionIcon>
      {open && <SectionInfoModal roomId={roomId} section={section} onClose={() => setOpen(false)} />}
    </>
  );
}
