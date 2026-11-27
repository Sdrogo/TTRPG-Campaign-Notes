import { useState } from 'react';
import { Alert, Button, FileButton, Group, Image, Input, Modal, NumberInput, Radio, Stack, Text } from '@mantine/core';
import { ImageIcon, LinkIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useChangeBackground, useResizePlane, useSetAreaLabels } from '../../hooks/useGeoMap';
import { MAX_PLANE_SIZE, MIN_PLANE_SIZE } from '../../lib/geoMaps';
import { ACCEPTED_IMAGE_TYPES } from '../../lib/images';
import type { AreaLabels, GeoMapDetail } from '../../types/geoMap';
import { ImageUrlPopover } from '../ImageUrlPopover';

/**
 * A geographic map's plane (spec 38 Decisions 2, 9): its size in map units,
 * which can't cut off an area or pin (the backend refuses, and says so), and
 * its background image, uploaded or taken from a URL, stretched over the
 * whole plane; and where a Document with several areas has its name (spec
 * 77 Decision 5). Each change is saved on its own.
 */
export function GeoMapDialog({
  roomId,
  map,
  onClose,
}: {
  roomId: string;
  map: GeoMapDetail;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const resize = useResizePlane(roomId, map.id);
  const background = useChangeBackground(roomId, map.id);
  const areaLabels = useSetAreaLabels(roomId, map.id);
  const [width, setWidth] = useState<number | string>(map.planeWidth);
  const [height, setHeight] = useState<number | string>(map.planeHeight);
  const sizeValid = [width, height].every(
    (side) => typeof side === 'number' && side >= MIN_PLANE_SIZE && side <= MAX_PLANE_SIZE,
  );
  const sizeChanged = width !== map.planeWidth || height !== map.planeHeight;

  return (
    <Modal opened onClose={onClose} title={t('maps.geo.planeTitle')} centered>
      <Stack gap="md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            resize.mutate({ width: width as number, height: height as number });
          }}
        >
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              {t('maps.geo.planeHelp', { min: MIN_PLANE_SIZE, max: MAX_PLANE_SIZE })}
            </Text>
            <Group grow>
              <NumberInput
                label={t('maps.geo.planeWidth')}
                value={width}
                onChange={setWidth}
                min={MIN_PLANE_SIZE}
                max={MAX_PLANE_SIZE}
                allowDecimal={false}
              />
              <NumberInput
                label={t('maps.geo.planeHeight')}
                value={height}
                onChange={setHeight}
                min={MIN_PLANE_SIZE}
                max={MAX_PLANE_SIZE}
                allowDecimal={false}
              />
            </Group>
            {resize.error && <Alert color="danger">{resize.error.message}</Alert>}
            <Group justify="flex-end">
              <Button type="submit" size="xs" disabled={!sizeValid || !sizeChanged} loading={resize.isPending}>
                {t('maps.geo.planeSave')}
              </Button>
            </Group>
          </Stack>
        </form>
        <Radio.Group
          label={t('maps.geo.areaLabels')}
          description={t('maps.geo.areaLabelsHelp')}
          value={(!areaLabels.isError && areaLabels.variables) || map.areaLabels || 'every'}
          onChange={(value) => areaLabels.mutate(value as AreaLabels)}
        >
          <Stack gap={6} mt={6}>
            <Radio value="every" label={t('maps.geo.areaLabelsEvery')} />
            <Radio value="largest" label={t('maps.geo.areaLabelsLargest')} />
          </Stack>
        </Radio.Group>
        {areaLabels.error && <Alert color="danger">{areaLabels.error.message}</Alert>}
        <Input.Wrapper label={t('maps.geo.background')} description={t('maps.geo.backgroundHelp')}>
          <Stack gap="xs" mt={6}>
            {map.backgroundUrl ? (
              <Image src={map.backgroundUrl} alt={t('maps.geo.background')} radius="sm" mah={160} fit="contain" />
            ) : (
              <Text size="sm" c="dimmed">
                {t('maps.geo.noBackground')}
              </Text>
            )}
            <Group gap="xs">
              <FileButton accept={ACCEPTED_IMAGE_TYPES} onChange={(file) => file && background.mutate({ file })}>
                {(props) => (
                  <Button {...props} size="xs" variant="default" leftSection={<ImageIcon size={16} />} loading={background.isPending}>
                    {t('maps.geo.uploadBackground')}
                  </Button>
                )}
              </FileButton>
              <ImageUrlPopover onAddUrl={(url) => background.mutate({ url })} position="bottom-start">
                {(toggle) => (
                  <Button size="xs" variant="default" leftSection={<LinkIcon size={16} />} onClick={toggle}>
                    {t('maps.geo.backgroundFromUrl')}
                  </Button>
                )}
              </ImageUrlPopover>
              {map.backgroundUrl && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="danger"
                  leftSection={<TrashIcon size={16} />}
                  onClick={() => background.mutate(null)}
                >
                  {t('maps.geo.removeBackground')}
                </Button>
              )}
            </Group>
            {background.error && <Alert color="danger">{background.error.message}</Alert>}
          </Stack>
        </Input.Wrapper>
      </Stack>
    </Modal>
  );
}
