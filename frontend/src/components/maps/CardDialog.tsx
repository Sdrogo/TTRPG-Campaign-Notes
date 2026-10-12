import { useState } from 'react';
import { Button, Checkbox, Group, Modal, SegmentedControl, Stack, Input, Textarea } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { CardSize, MapCard } from '../../types/map';
import type { TextCardValues } from '../../lib/maps';
import { MapColorPicker } from './MapColorPicker';

/** The backend's limits on a text card's text and a Document card's caption. */
const MAX_TEXT_LENGTH = 300;
const MAX_CAPTION_LENGTH = 80;

interface CardDialogProps {
  /** The card to edit; absent to write a new text card. */
  card?: MapCard;
  /** Only the Master marks a text card Master only (Decision 6). */
  isMaster: boolean;
  onSave: (values: TextCardValues & { caption: string | null }) => void;
  /** Takes the card off the map; absent for a new card. */
  onDelete?: () => void;
  onClose: () => void;
}

/**
 * Edits a card (spec 28 Decisions 6, 8). A Document card gets its caption on
 * this map (replacing the Document's subtitle here only), color and strike; a
 * text card its text, size, color, strike and, for the Master, Master only.
 * Mounted per card, so it starts from the card's values.
 */
export function CardDialog({ card, isMaster, onSave, onDelete, onClose }: CardDialogProps) {
  const { t } = useTranslation();
  const isDocument = Boolean(card?.documentId);
  const [text, setText] = useState(card?.text ?? '');
  const [caption, setCaption] = useState(card?.caption ?? '');
  const [size, setSize] = useState<CardSize>(card?.size ?? 'normal');
  const [color, setColor] = useState(card?.color ?? 'default');
  const [struck, setStruck] = useState(card?.struck ?? false);
  const [masterOnly, setMasterOnly] = useState(card?.masterOnly ?? false);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave({
      text: text.trim(),
      caption: caption.trim() || null,
      size,
      color,
      struck,
      masterOnly,
    });
  };

  const title = isDocument
    ? t('maps.card.editDocument', { name: card!.document!.name })
    : card
      ? t('maps.card.editText')
      : t('maps.card.newText');

  return (
    <Modal opened onClose={onClose} title={title} centered>
      <form onSubmit={handleSubmit}>
        <Stack gap="sm">
          {isDocument ? (
            <Textarea
              label={t('maps.card.caption')}
              description={t('maps.card.captionHint')}
              placeholder={card!.document!.subtitle ?? undefined}
              value={caption}
              onChange={(event) => setCaption(event.currentTarget.value)}
              maxLength={MAX_CAPTION_LENGTH}
              autosize
              minRows={2}
              maxRows={2}
              data-autofocus
            />
          ) : (
            <>
              <Textarea
                label={t('maps.card.text')}
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                maxLength={MAX_TEXT_LENGTH}
                autosize
                minRows={2}
                required
                data-autofocus
              />
              <Input.Wrapper label={t('maps.card.size')}>
                <SegmentedControl
                  fullWidth
                  mt={4}
                  value={size}
                  onChange={(value) => setSize(value as CardSize)}
                  data={[
                    { value: 'normal', label: t('maps.card.sizes.normal') },
                    { value: 'large', label: t('maps.card.sizes.large') },
                    { value: 'title', label: t('maps.card.sizes.title') },
                  ]}
                />
              </Input.Wrapper>
            </>
          )}
          <MapColorPicker value={color} onChange={setColor} />
          <Checkbox
            label={t('maps.struck')}
            checked={struck}
            onChange={(event) => setStruck(event.currentTarget.checked)}
          />
          {isMaster && !isDocument && (
            <Checkbox
              label={t('maps.masterOnlyCard')}
              checked={masterOnly}
              onChange={(event) => setMasterOnly(event.currentTarget.checked)}
            />
          )}
          <Group justify={onDelete ? 'space-between' : 'flex-end'}>
            {onDelete && (
              <Button variant="subtle" color="red" onClick={onDelete}>
                {t('maps.card.remove')}
              </Button>
            )}
            <Button type="submit">{card ? t('common.save') : t('common.add')}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
