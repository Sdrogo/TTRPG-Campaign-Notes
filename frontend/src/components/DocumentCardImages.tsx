import { Box } from '@mantine/core';
import { Carousel } from '@mantine/carousel';
import type { DocumentImage } from '../types/document';
import { useTranslation } from 'react-i18next';

// The whole card is a link (see `DocumentCard`), which sits above the images
// so clicking one opens the Document. The carousel's own controls have to
// come back out on top of it, or they'd just navigate too.
const ABOVE_CARD_LINK = 2;

// The panel's left edge fades into the card's own background (Mantine's dark
// Card surface), so the image melts into the card instead of ending on a seam.
const FADE_INTO_CARD = 'linear-gradient(to right, var(--mantine-color-dark-6) 0%, transparent 35%)';

interface DocumentCardImagesProps {
  images: DocumentImage[];
  documentName: string;
}

/** Fill the box it's placed in with the Document's images, in their supplied
 *  order (normally favorite first), cropped to cover it edge to edge, with the
 *  left edge fading into the card. Multiple images use a carousel. Returns
 *  null when there are no images. Read-only: managing them (adding, deleting,
 *  moving the favorite) stays on the detail page. */
export function DocumentCardImages({ images, documentName }: DocumentCardImagesProps) {
  const { t } = useTranslation();

  if (images.length === 0) {
    return null;
  }

  return (
    <Box pos="relative" h="100%" bg="var(--bg-base)">
      {images.length === 1 ? (
        <CardImage image={images[0]} alt={documentName} />
      ) : (
        <Carousel
          height="100%"
          withIndicators
          // Dragging would fight the card's link overlay, so the arrows - kept
          // visible rather than shown on hover, since a touch screen has none -
          // are the way through the images.
          emblaOptions={{ loop: true, watchDrag: false }}
          styles={{
            root: { height: '100%' },
            controls: { zIndex: ABOVE_CARD_LINK, opacity: 1 },
            indicators: { zIndex: ABOVE_CARD_LINK },
            indicator: { width: 10, height: 3 },
          }}
        >
          {images.map((image, index) => (
            <Carousel.Slide key={image.id}>
              <CardImage image={image} alt={t('images.numbered', { name: documentName, index: index + 1 })} />
            </Carousel.Slide>
          ))}
        </Carousel>
      )}
      <Box
        data-testid="card-image-fade"
        pos="absolute"
        inset={0}
        style={{ background: FADE_INTO_CARD, pointerEvents: 'none' }}
      />
    </Box>
  );
}

/** An image cropped to cover its box, anchored at the top so a portrait's
 *  face survives the crop. */
function CardImage({ image, alt }: { image: DocumentImage; alt: string }) {
  return (
    <Box
      component="img"
      src={image.url}
      alt={alt}
      loading="lazy"
      draggable={false}
      w="100%"
      h="100%"
      style={{ display: 'block', objectFit: 'cover', objectPosition: 'center top' }}
    />
  );
}
