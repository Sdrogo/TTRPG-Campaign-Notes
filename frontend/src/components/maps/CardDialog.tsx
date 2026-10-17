import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Group,
  Input,
  Modal,
  SegmentedControl,
  Stack,
  Textarea,
  UnstyledButton,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { StoredImage } from '../../types/image';
import type { CardSize, MapCard } from '../../types/map';
import type { TextCardValues } from '../../lib/maps';
import { MapColorPicker } from './MapColorPicker';

/** The backend's limits on a text card's text and a Document card's caption. */
const MAX_TEXT_LENGTH = 300;
const MAX_CAPTION_LENGTH = 80;

interface CardDialogProps {
  /** The card to edit; absent to write a new text card. */
  card?: MapCard;
  /** The Document's images, favorite first, for a Document card's choice of image. */
  images?: StoredImage[];
  /** Only the Master marks a text card Master only (Decision 6). */
  isMaster: boolean;
  onSave: (values: TextCardValues & { caption: string | null; imageId: string | null }) => void;
  /** Takes the card off the map; absent for a new card. */
  onDelete?: () => void;
  onClose: () => void;
}

/**
 * Edits a card (spec 28 Decisions 6, 8). A Document card gets its caption on
 * this map (replacing the Document's subtitle here only), the image it shows
 * (the Document's favorite until another is picked), color and strike; a
 * text card its text, size, color, strike and, for the Master, Master only.
 * Mounted per card, so it starts from the card's values.
 */
export function CardDialog({ card, images = [], isMaster, onSave, onDelete, onClose }: CardDialogProps) {
  const { t } = useTranslation();
  const isDocument = Boolean(card?.documentId);
  const [text, setText] = useState(card?.text ?? '');
  const [caption, setCaption] = useState(card?.caption ?? '');
  // The favorite leads `images`; picking it again goes back to following it.
  const [imageId, setImageId] = useState<string | null>(card?.imageId ?? null);
  const shownImageId = imageId ?? images[0]?.id;
  const [size, setSize] = useState<CardSize>(card?.size ?? 'normal');
  const [color, setColor] = useState(card?.color ?? 'default');
  const [struck, setStruck] = useState(card?.struck ?? false);
  const [masterOnly, setMasterOnly] = useState(card?.masterOnly ?? false);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave({
      text: text.trim(),
      caption: caption.trim() || null,
      imageId,
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
            <>
              <Textarea
                spellCheck
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
              {images.length > 1 && (
                <Input.Wrapper label={t('maps.card.image')} description={t('maps.card.imageHint')}>
                  <Group gap="xs" mt={4}>
                    {images.map((image, index) => (
                      <UnstyledButton
                        key={image.id}
                        aria-label={t('maps.card.imageNumbered', {
                          number: index + 1,
                        })}
                        aria-pressed={image.id === shownImageId}
                        // The favorite is the default: picking it follows it again.
                        onClick={() => setImageId(index === 0 ? null : image.id)}
                      >
                        <Box
                          component="img"
                          src={image.url}
                          alt=""
                          w={56}
                          h={72}
                          draggable={false}
                          style={{
                            display: 'block',
                            objectFit: 'cover',
                            objectPosition: 'center top',
                            borderRadius: 'var(--mantine-radius-sm)',
                            outline:
                              image.id === shownImageId
                                ? '2px solid var(--accent-primary)'
                                : '1px solid var(--border-default)',
                            outlineOffset: 1,
                          }}
                        />
                      </UnstyledButton>
                    ))}
                  </Group>
                </Input.Wrapper>
              )}
            </>
          ) : (
            <>
              <Textarea
                spellCheck
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
