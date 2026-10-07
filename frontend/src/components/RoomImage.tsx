import { Center, Image } from '@mantine/core';
import { ImageIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';

interface RoomImageProps {
  /** The image to show; null shows an empty frame. */
  url: string | null;
  /** The frame's width in px; the height follows a page's proportions. */
  width?: number;
}

/**
 * The Room's image (spec 26) in a page-shaped frame, since it is the PDF's
 * cover: an empty frame with an image icon when there is none.
 */
export function RoomImage({ url, width = 120 }: RoomImageProps) {
  const { t } = useTranslation();
  const height = Math.round(width * Math.SQRT2);
  if (url) {
    return (
      <Image src={url} alt={t('rooms.image.alt')} w={width} h={height} radius="md" fit="cover" />
    );
  }
  return (
    <Center
      w={width}
      h={height}
      bg="var(--bg-base)"
      style={{
        border: '1px dashed var(--border-default)',
        borderRadius: 'var(--mantine-radius-md)',
      }}
      aria-hidden
    >
      <ImageIcon size={32} color="var(--mantine-color-dimmed)" />
    </Center>
  );
}
