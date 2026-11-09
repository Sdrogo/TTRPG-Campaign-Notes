import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Collapse,
  Group,
  Modal,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import {
  CaretDownIcon,
  CaretRightIcon,
  InfoIcon,
  LinkBreakIcon,
  PencilSimpleIcon,
  PlusIcon,
  StackIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import {
  useCreatePreset,
  useDeletePreset,
  useLegendPresets,
  useSaveLegend,
  useUpdatePreset,
} from '../../hooks/useMapLegend';
import { MAP_COLORS, cleanMeanings, colorValue, replacedMeanings, usedColors } from '../../lib/maps';
import type { ColorMeanings, LegendPreset, LegendPresetRef, MapArrow, MapColor } from '../../types/map';
import { LegendSample } from './MapLegend';

/** The longest meaning and preset name the API takes (spec 68 Decisions 2, 19). */
const MAX_MEANING_LENGTH = 40;
const MAX_PRESET_NAME_LENGTH = 60;

interface MapLegendDialogProps {
  roomId: string;
  mapId: string;
  /** What the colors mean now (the preset's when linked). */
  meanings: ColorMeanings;
  preset: LegendPresetRef | null;
  /** The relations the editor sees, for the colors in use. */
  arrows: MapArrow[];
  isMaster: boolean;
  onClose: () => void;
}

type View =
  | { kind: 'edit' }
  | { kind: 'apply' }
  | { kind: 'saveAs' }
  | { kind: 'manage' }
  | { kind: 'preset'; preset: LegendPreset | null };

/**
 * "Legenda dei colori" (spec 68 Decisions 10, 20-23): the meanings of the
 * colors the map's relations use, then, folded, those of unused colors. On a
 * map linked to a preset the Master's save edits the preset for every linked
 * map, anyone else reads them and may unlink the map, keeping a copy. It also
 * applies a Room preset, saves one (the Master), and manages them.
 */
export function MapLegendDialog({ roomId, mapId, meanings, preset, arrows, isMaster, onClose }: MapLegendDialogProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ kind: 'edit' });
  const saveLegend = useSaveLegend(roomId, mapId);
  const presets = useLegendPresets(roomId, true);
  const roomPresets = presets.data ?? [];
  const createPreset = useCreatePreset(roomId);
  const updatePreset = useUpdatePreset(roomId);
  const deletePreset = useDeletePreset(roomId);
  const error = saveLegend.error ?? createPreset.error ?? updatePreset.error ?? deletePreset.error;
  const busy = saveLegend.isPending || createPreset.isPending || updatePreset.isPending || deletePreset.isPending;
  const reset = () => {
    saveLegend.reset();
    createPreset.reset();
    updatePreset.reset();
    deletePreset.reset();
  };
  const go = (next: View) => {
    reset();
    setView(next);
  };

  const titles: Record<View['kind'], string> = {
    edit: t('maps.legend.dialogTitle'),
    apply: t('maps.legend.applyTitle'),
    saveAs: t('maps.legend.saveAsTitle'),
    manage: t('maps.legend.manageTitle'),
    preset: t(view.kind === 'preset' && view.preset ? 'maps.legend.editPresetTitle' : 'maps.legend.newPresetTitle'),
  };

  let body: React.ReactNode;
  if (view.kind === 'edit') {
    body = (
      <EditView
        meanings={meanings}
        preset={preset}
        arrows={arrows}
        isMaster={isMaster}
        mapCount={presets.data?.find((p) => p.id === preset?.id)?.mapCount}
        busy={busy}
        onApply={() => go({ kind: 'apply' })}
        onSaveAs={() => go({ kind: 'saveAs' })}
        onManage={() => go({ kind: 'manage' })}
        onUnlink={() => saveLegend.mutate({ meanings }, { onSuccess: onClose })}
        onCancel={onClose}
        onSave={(draft) => {
          if (preset) {
            updatePreset.mutate({ id: preset.id, entries: cleanMeanings(draft) }, { onSuccess: onClose });
          } else {
            saveLegend.mutate({ meanings: cleanMeanings(draft) }, { onSuccess: onClose });
          }
        }}
      />
    );
  } else if (view.kind === 'apply') {
    body = (
      <ApplyView
        presets={roomPresets}
        current={meanings}
        busy={busy}
        onBack={() => go({ kind: 'edit' })}
        onApply={(id) => saveLegend.mutate({ presetId: id }, { onSuccess: onClose })}
      />
    );
  } else if (view.kind === 'saveAs') {
    body = (
      <SaveAsView
        busy={busy}
        onBack={() => go({ kind: 'edit' })}
        onSave={(name) =>
          createPreset.mutate(
            { name, entries: cleanMeanings(meanings) },
            // The map follows the preset it was saved as (Decision 23).
            { onSuccess: (created) => saveLegend.mutate({ presetId: created.id }, { onSuccess: onClose }) },
          )
        }
      />
    );
  } else if (view.kind === 'manage') {
    body = (
      <ManageView
        presets={roomPresets}
        busy={busy}
        onBack={() => go({ kind: 'edit' })}
        onNew={() => go({ kind: 'preset', preset: null })}
        onEdit={(item) => go({ kind: 'preset', preset: item })}
        onDelete={(id) => deletePreset.mutate(id)}
      />
    );
  } else {
    const edited = view.preset;
    body = (
      <PresetView
        key={edited?.id ?? 'new'}
        preset={edited}
        busy={busy}
        onBack={() => go({ kind: 'manage' })}
        onSave={(name, entries) =>
          edited
            ? updatePreset.mutate({ id: edited.id, name, entries }, { onSuccess: () => go({ kind: 'manage' }) })
            : createPreset.mutate({ name, entries }, { onSuccess: () => go({ kind: 'manage' }) })
        }
      />
    );
  }

  return (
    <Modal opened onClose={onClose} title={titles[view.kind]} centered size="lg">
      <Stack gap="sm">
        {body}
        {error && (
          <Text size="sm" c="red" role="alert">
            {error.message}
          </Text>
        )}
      </Stack>
    </Modal>
  );
}

function ColorName({ color }: { color: MapColor }) {
  const { t } = useTranslation();
  return (
    <Group gap={8} wrap="nowrap" w={130} style={{ flex: 'none' }}>
      <LegendSample color={color} />
      <Text size="sm" c="dimmed">
        {t(`maps.colors.${color}`)}
      </Text>
    </Group>
  );
}

/** One color's meaning: an input, or read-only text. */
function MeaningRow({
  color,
  value,
  readOnly,
  onChange,
  onRemove,
}: {
  color: MapColor;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const name = t(`maps.colors.${color}`);
  return (
    <Group gap="sm" wrap="nowrap">
      <ColorName color={color} />
      {readOnly ? (
        <Text size="sm" style={{ flex: 1 }}>
          {value || '—'}
        </Text>
      ) : (
        <>
          <TextInput
            style={{ flex: 1 }}
            aria-label={t('maps.legend.meaningOf', { color: name })}
            placeholder={t('maps.legend.meaningPlaceholder')}
            value={value}
            maxLength={MAX_MEANING_LENGTH}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={t('maps.legend.removeMeaning', { color: name })}
            onClick={onRemove}
          >
            <XIcon size={16} />
          </ActionIcon>
        </>
      )}
    </Group>
  );
}

function EditView({
  meanings,
  preset,
  arrows,
  isMaster,
  mapCount,
  busy,
  onApply,
  onSaveAs,
  onManage,
  onUnlink,
  onCancel,
  onSave,
}: {
  meanings: ColorMeanings;
  preset: LegendPresetRef | null;
  arrows: MapArrow[];
  isMaster: boolean;
  mapCount: number | undefined;
  busy: boolean;
  onApply: () => void;
  onSaveAs: () => void;
  onManage: () => void;
  onUnlink: () => void;
  onCancel: () => void;
  onSave: (draft: ColorMeanings) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ColorMeanings>(meanings);
  const [unusedOpen, setUnusedOpen] = useState(false);
  const readOnly = !!preset && !isMaster;
  const used = usedColors(arrows);
  const unused = MAP_COLORS.filter((color) => !used.includes(color) && meanings[color]);
  const set = (color: MapColor, value: string) => setDraft((current) => ({ ...current, [color]: value }));
  const row = (color: MapColor) => (
    <MeaningRow
      key={color}
      color={color}
      value={draft[color] ?? ''}
      readOnly={readOnly}
      onChange={(value) => set(color, value)}
      onRemove={() => set(color, '')}
    />
  );

  return (
    <>
      {preset && (
        <Alert variant="light" color="blue" icon={<StackIcon size={18} />} p="xs">
          {isMaster
            ? t('maps.legend.linkedMaster', { name: preset.name, count: mapCount ?? 1 })
            : t('maps.legend.linkedOther', { name: preset.name })}
        </Alert>
      )}
      <Text size="xs" tt="uppercase" c="dimmed" fw={600}>
        {t('maps.legend.usedColors')}
      </Text>
      {used.length > 0 ? (
        <Stack gap={6}>{used.map(row)}</Stack>
      ) : (
        <Text size="sm" c="dimmed">
          {t('maps.legend.noRelations')}
        </Text>
      )}
      {unused.length > 0 && (
        <Box>
          <UnstyledButton
            onClick={() => setUnusedOpen((open) => !open)}
            aria-expanded={unusedOpen}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {unusedOpen ? <CaretDownIcon size={14} /> : <CaretRightIcon size={14} />}
            <Text size="sm" c="dimmed">
              {t('maps.legend.unused', { count: unused.length })}
            </Text>
          </UnstyledButton>
          <Collapse expanded={unusedOpen}>
            <Stack gap={6} mt={6}>
              {unused.map(row)}
            </Stack>
          </Collapse>
        </Box>
      )}
      <Group gap={6} wrap="nowrap" align="flex-start">
        <InfoIcon size={16} color="var(--text-muted)" style={{ flex: 'none', marginTop: 2 }} />
        <Text size="xs" c="dimmed">
          {t('maps.legend.visibleHint')}
        </Text>
      </Group>
      <Group gap="xs" justify="space-between">
        <Group gap={4}>
          {preset ? (
            <Button variant="subtle" color="gray" size="sm" leftSection={<LinkBreakIcon size={16} />} onClick={onUnlink} disabled={busy}>
              {t('maps.legend.unlink')}
            </Button>
          ) : (
            <Button variant="subtle" color="gray" size="sm" leftSection={<StackIcon size={16} />} onClick={onApply}>
              {t('maps.legend.apply')}
            </Button>
          )}
          {isMaster && !preset && (
            <Button
              variant="subtle"
              color="gray"
              size="sm"
              onClick={onSaveAs}
              disabled={Object.keys(cleanMeanings(meanings)).length === 0}
            >
              {t('maps.legend.saveAs')}
            </Button>
          )}
          {isMaster && (
            <Button variant="subtle" color="gray" size="sm" onClick={onManage}>
              {t('maps.legend.manage')}
            </Button>
          )}
        </Group>
        <Group gap="xs">
          <Button variant="default" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          {!readOnly && (
            <Button onClick={() => onSave(draft)} loading={busy}>
              {t('common.save')}
            </Button>
          )}
        </Group>
      </Group>
    </>
  );
}

function PresetSummary({ preset }: { preset: LegendPreset }) {
  const { t } = useTranslation();
  return (
    <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
      <Group gap="xs">
        <Text fw={600}>{preset.name}</Text>
        <Badge variant="light" color="gray" size="sm">
          {t('maps.legend.mapCount', { count: preset.mapCount })}
        </Badge>
      </Group>
      <Group gap="4px 12px">
        {MAP_COLORS.filter((color) => preset.entries[color]).map((color) => (
          <Group key={color} gap={5} wrap="nowrap">
            <Box w={9} h={9} style={{ borderRadius: '50%', background: colorValue(color) }} />
            <Text size="xs" c="dimmed">
              {preset.entries[color]}
            </Text>
          </Group>
        ))}
      </Group>
    </Stack>
  );
}

function ApplyView({
  presets,
  current,
  busy,
  onBack,
  onApply,
}: {
  presets: LegendPreset[];
  /** The map's own meanings, which applying drops (Decision 21). */
  current: ColorMeanings;
  busy: boolean;
  onBack: () => void;
  onApply: (presetId: string) => void;
}) {
  const { t } = useTranslation();
  // The first preset until one is picked (the list may arrive after the view opens).
  const [chosen, setChosen] = useState<string | null>(null);
  const picked = presets.find((preset) => preset.id === chosen) ?? presets[0];
  const replaced = picked ? replacedMeanings(current, picked.entries) : 0;
  return (
    <>
      <Text size="sm" c="dimmed">
        {t('maps.legend.applyHint')}
      </Text>
      {presets.length === 0 ? (
        <Text size="sm">{t('maps.legend.noPresets')}</Text>
      ) : (
        <Radio.Group value={picked!.id} onChange={setChosen} aria-label={t('maps.legend.applyTitle')}>
          <Stack gap="xs">
            {presets.map((preset) => (
              <Radio.Card key={preset.id} value={preset.id} p="sm" radius="md">
                <Group wrap="nowrap" align="flex-start">
                  <Radio.Indicator mt={3} />
                  <PresetSummary preset={preset} />
                </Group>
              </Radio.Card>
            ))}
          </Stack>
        </Radio.Group>
      )}
      {replaced > 0 && (
        <Alert variant="light" color="yellow" icon={<WarningIcon size={18} />} p="xs">
          {t('maps.legend.replaceWarning', { count: replaced })}
        </Alert>
      )}
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button disabled={!picked} loading={busy} onClick={() => onApply(picked!.id)}>
          {t('maps.legend.applyButton')}
        </Button>
      </Group>
    </>
  );
}

function SaveAsView({ busy, onBack, onSave }: { busy: boolean; onBack: () => void; onSave: (name: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  return (
    <>
      <TextInput
        label={t('maps.legend.presetName')}
        value={name}
        maxLength={MAX_PRESET_NAME_LENGTH}
        onChange={(event) => setName(event.currentTarget.value)}
        data-autofocus
      />
      <Text size="xs" c="dimmed">
        {t('maps.legend.saveAsHint')}
      </Text>
      <Group justify="flex-end" gap="xs">
        <Button variant="default" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button disabled={!name.trim()} loading={busy} onClick={() => onSave(name.trim())}>
          {t('common.save')}
        </Button>
      </Group>
    </>
  );
}

function ManageView({
  presets,
  busy,
  onBack,
  onNew,
  onEdit,
  onDelete,
}: {
  presets: LegendPreset[];
  busy: boolean;
  onBack: () => void;
  onNew: () => void;
  onEdit: (preset: LegendPreset) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <>
      {presets.length === 0 && <Text size="sm">{t('maps.legend.noPresets')}</Text>}
      <Stack gap="xs">
        {presets.map((preset) => (
          <Group
            key={preset.id}
            wrap="nowrap"
            align="flex-start"
            p="sm"
            style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--mantine-radius-md)' }}
          >
            <PresetSummary preset={preset} />
            {confirming === preset.id ? (
              <Group gap={4} wrap="nowrap">
                <Button size="xs" color="danger" loading={busy} onClick={() => onDelete(preset.id)}>
                  {t('common.delete')}
                </Button>
                <Button size="xs" variant="default" onClick={() => setConfirming(null)}>
                  {t('common.cancel')}
                </Button>
              </Group>
            ) : (
              <Group gap={2} wrap="nowrap">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={t('maps.legend.editPreset', { name: preset.name })}
                  onClick={() => onEdit(preset)}
                >
                  <PencilSimpleIcon size={16} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={t('maps.legend.deletePreset', { name: preset.name })}
                  onClick={() => setConfirming(preset.id)}
                >
                  <TrashIcon size={16} />
                </ActionIcon>
              </Group>
            )}
          </Group>
        ))}
      </Stack>
      <Text size="xs" c="dimmed">
        {t('maps.legend.deleteHint')}
      </Text>
      <Group justify="space-between" gap="xs">
        <Button variant="subtle" color="gray" leftSection={<PlusIcon size={16} />} onClick={onNew}>
          {t('maps.legend.newPreset')}
        </Button>
        <Button variant="default" onClick={onBack}>
          {t('common.back')}
        </Button>
      </Group>
    </>
  );
}

function PresetView({
  preset,
  busy,
  onBack,
  onSave,
}: {
  preset: LegendPreset | null;
  busy: boolean;
  onBack: () => void;
  onSave: (name: string, entries: ColorMeanings) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(preset?.name ?? '');
  const [draft, setDraft] = useState<ColorMeanings>(preset?.entries ?? {});
  const [colors, setColors] = useState<MapColor[]>(MAP_COLORS.filter((color) => preset?.entries[color]));
  const others = MAP_COLORS.filter((color) => !colors.includes(color));
  const entries = cleanMeanings(draft);
  return (
    <>
      <TextInput
        label={t('maps.legend.presetName')}
        value={name}
        maxLength={MAX_PRESET_NAME_LENGTH}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <Stack gap={6}>
        {colors.map((color) => (
          <MeaningRow
            key={color}
            color={color}
            value={draft[color] ?? ''}
            readOnly={false}
            onChange={(value) => setDraft((current) => ({ ...current, [color]: value }))}
            onRemove={() => {
              setColors((current) => current.filter((c) => c !== color));
              setDraft((current) => ({ ...current, [color]: '' }));
            }}
          />
        ))}
      </Stack>
      {others.length > 0 && (
        <Select
          aria-label={t('maps.legend.addColor')}
          placeholder={t('maps.legend.addColor')}
          value={null}
          data={others.map((color) => ({ value: color, label: t(`maps.colors.${color}`) }))}
          onChange={(value) => setColors((current) => MAP_COLORS.filter((c) => c === value || current.includes(c)))}
        />
      )}
      <Group justify="space-between" gap="xs">
        <Anchor component="button" type="button" size="sm" onClick={onBack}>
          {t('common.back')}
        </Anchor>
        <Button disabled={!name.trim() || Object.keys(entries).length === 0} loading={busy} onClick={() => onSave(name.trim(), entries)}>
          {t('common.save')}
        </Button>
      </Group>
    </>
  );
}
