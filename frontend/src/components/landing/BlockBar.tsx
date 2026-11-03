import { useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  CloseButton,
  Drawer,
  Group,
  Menu,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import {
  CaretDownIcon,
  CheckIcon,
  DotsThreeVerticalIcon,
  EyeIcon,
  EyeSlashIcon,
  FilesIcon,
  MapTrifoldIcon,
  PencilSimpleIcon,
  PlusIcon,
  TimerIcon,
  ToolboxIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { DragHandle, SortableItem, SortableList } from './Sortable';
import { defaultBlockHeading, featureLabel, groupLabel, tagsOf } from '../../lib/landingText';
import { sameTagSet } from '../../lib/mainItems';
import {
  SESSION_ZERO_FEATURES,
  type BlockInput,
  type BlockKind,
  type BlockMapKind,
  type SessionZeroFeature,
  type ToolKind,
} from '../../types/landing';
import type { MainItem, Tag } from '../../types/tag';

/** A block's kind icon, on its bar and on the add-block tiles. */
export function BlockKindIcon({ kind, size = 18 }: { kind: BlockKind; size?: number }) {
  if (kind === 'documents') return <FilesIcon size={size} aria-hidden="true" />;
  if (kind === 'maps') return <MapTrifoldIcon size={size} aria-hidden="true" />;
  if (kind === 'tool') return <ToolboxIcon size={size} aria-hidden="true" />;
  if (kind === 'clocks') return <TimerIcon size={size} aria-hidden="true" />;
  return <UsersThreeIcon size={size} aria-hidden="true" />;
}

/** On a phone a picker opens as a bottom sheet, elsewhere as a popover (spec 55 Decision 14). */
const PHONE_QUERY = '(max-width: 48em)';

interface PickerProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  target: ReactNode;
  children: ReactNode;
  width?: number;
}

/** A popover by its target, or a bottom sheet on a phone. */
export function Picker({ opened, onClose, title, target, children, width = 300 }: PickerProps) {
  const phone = useMediaQuery(PHONE_QUERY, false);
  if (phone) {
    return (
      <>
        {target}
        <Drawer opened={opened} onClose={onClose} position="bottom" size="auto" title={title} radius="md">
          {children}
        </Drawer>
      </>
    );
  }
  return (
    <Popover opened={opened} onChange={(open) => !open && onClose()} position="bottom-start" width={width} shadow="md" trapFocus withinPortal>
      <Popover.Target>{target}</Popover.Target>
      <Popover.Dropdown aria-label={title}>{children}</Popover.Dropdown>
    </Popover>
  );
}

/** A small removable chip of the block bar. */
export function Chip({ label, onRemove, removeLabel }: { label: string; onRemove?: () => void; removeLabel: string }) {
  return (
    <Badge
      variant="light"
      color="gray"
      size="lg"
      radius="sm"
      tt="none"
      fw={500}
      rightSection={onRemove ? <CloseButton size="xs" onClick={onRemove} aria-label={removeLabel} /> : undefined}
      className="room-landing-chip"
    >
      {label}
    </Badge>
  );
}

/** Lists Tags to pick, filtered by a search field; `onPick` gets the one clicked. */
export function TagPickerList({ tags, onPick }: { tags: Tag[]; onPick: (tag: Tag) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const shown = tags.filter((tag) => tag.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Stack gap="xs">
      <TextInput
        data-autofocus
        size="xs"
        placeholder={t('roomLanding.edit.searchTag')}
        aria-label={t('roomLanding.edit.searchTag')}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <ScrollArea.Autosize mah={240}>
        <Stack gap={2}>
          {shown.length === 0 && (
            <Text size="xs" c="dimmed">
              {t('common.noResults')}
            </Text>
          )}
          {shown.map((tag) => (
            <UnstyledButton key={tag.id} className="room-landing-option" onClick={() => onPick(tag)}>
              #{tag.name}
            </UnstyledButton>
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}

/** The features list: ticks on the ones shown, a newly ticked one goes last. The last one can't be unticked. */
export function FeaturePickerList({ features, onChange }: { features: SessionZeroFeature[]; onChange: (features: SessionZeroFeature[]) => void }) {
  return (
    <Stack gap={6}>
      {SESSION_ZERO_FEATURES.map((feature) => {
        const checked = features.includes(feature);
        return (
          <Checkbox
            key={feature}
            label={featureLabel(feature)}
            checked={checked}
            disabled={checked && features.length === 1}
            onChange={() => onChange(checked ? features.filter((f) => f !== feature) : [...features, feature])}
          />
        );
      })}
    </Stack>
  );
}

interface BlockBarProps {
  block: BlockInput;
  tags: Tag[];
  mainItems: MainItem[];
  /** Saves the block with these changes. */
  onChange: (block: BlockInput) => void;
  onDelete: () => void;
  /**
   * Opens a picker as soon as the bar shows: a new block's Tags or features,
   * or the groups popover again after a save remounted the bar.
   */
  initialPicker?: 'tags' | 'features' | 'groups' | null;
  /**
   * Told when the groups popover opens or closes: every save gives the
   * blocks new ids and so a new bar, which reopens the popover through
   * `initialPicker` until the user closes it.
   */
  onGroupsOpenChange?: (open: boolean) => void;
  /** A block not saved yet (no Tag or feature): closing its picker empty drops it. */
  onCancelDraft?: () => void;
  /** A tool block's step kind and whether the Players see it, with the eye toggle (spec 60 Decision 4). */
  tool?: { kind: ToolKind; visible: boolean; onToggleVisible: () => void };
  /** A Clocks block's own filter (spec 61): its chips and "Tutti i clock aperti". */
  children?: ReactNode;
}

/**
 * A block's heading in edit mode (spec 55 Decision 13), one line that wraps
 * on a phone: the drag handle, the kind's icon, the heading edited in
 * place, the filter as chips (Tags, the map kind, the features), "Raggruppa"
 * on a Documents block, and a ⋮ with "Elimina".
 */
export function BlockBar({ block, tags, mainItems, onChange, onDelete, initialPicker = null, onCancelDraft, onGroupsOpenChange, tool, children }: BlockBarProps) {
  const { t } = useTranslation();
  const [picker, setPicker] = useState<'tags' | 'features' | 'groups' | null>(initialPicker);
  const closePicker = () => {
    setPicker(null);
    onCancelDraft?.();
  };
  const setGroupsOpen = (open: boolean) => {
    setPicker(open ? 'groups' : null);
    onGroupsOpenChange?.(open);
  };
  const blockTags = tagsOf(block.tagIds, tags);

  return (
    <Group gap={6} wrap="wrap" className="room-landing-bar" align="center">
      <DragHandle label={t('roomLanding.edit.dragBlock')} />
      <BlockKindIcon kind={block.kind} />
      <HeadingEditor
        heading={block.heading}
        placeholder={defaultBlockHeading({ ...block, toolKind: tool?.kind ?? null }, tags)}
        onSave={(heading) => onChange({ ...block, heading })}
      />
      <Text c="dimmed" aria-hidden="true">
        ·
      </Text>
      {block.kind === 'documents' && (
        <>
          {blockTags.map((tag) => (
            <Chip
              key={tag.id}
              label={`#${tag.name}`}
              removeLabel={t('roomLanding.edit.remove', { name: `#${tag.name}` })}
              onRemove={block.tagIds.length > 1 ? () => onChange({ ...block, tagIds: block.tagIds.filter((id) => id !== tag.id) }) : undefined}
            />
          ))}
          <Picker
            opened={picker === 'tags'}
            onClose={closePicker}
            title={t('roomLanding.edit.addTag')}
            target={
              <Button size="compact-sm" variant="subtle" leftSection={<PlusIcon size={14} />} onClick={() => setPicker('tags')}>
                {t('roomLanding.edit.addTag')}
              </Button>
            }
          >
            <TagPickerList
              tags={tags.filter((tag) => !block.tagIds.includes(tag.id))}
              onPick={(tag) => {
                setPicker(null);
                onChange({ ...block, tagIds: [...block.tagIds, tag.id] });
              }}
            />
          </Picker>
          <Text c="dimmed" aria-hidden="true">
            ·
          </Text>
          <Picker
            opened={picker === 'groups'}
            onClose={() => setGroupsOpen(false)}
            title={t('roomLanding.edit.groups')}
            width={340}
            target={
              <Button size="compact-sm" variant="light" rightSection={<CaretDownIcon size={12} />} onClick={() => setGroupsOpen(true)}>
                {block.groups.length > 0 ? t('roomLanding.edit.groupedBy', { count: block.groups.length }) : t('roomLanding.edit.group')}
              </Button>
            }
          >
            <GroupsEditor groups={block.groups} tags={tags} mainItems={mainItems} onChange={(groups) => onChange({ ...block, groups })} />
          </Picker>
        </>
      )}
      {block.kind === 'maps' && <MapKindChip mapKind={block.mapKind} onChange={(mapKind) => onChange({ ...block, mapKind })} />}
      {block.kind === 'session_zero' && (
        <>
          <SortableList ids={block.features} layout="horizontal" onMove={(ids) => onChange({ ...block, features: ids as SessionZeroFeature[] })}>
            {block.features.map((feature) => (
              <SortableItem key={feature} id={feature}>
                {({ ref, style }) => (
                  <Group ref={ref} style={style} gap={0} wrap="nowrap">
                    <DragHandle size="xs" label={t('roomLanding.edit.dragFeature', { name: featureLabel(feature) })} />
                    <Chip
                      label={featureLabel(feature)}
                      removeLabel={t('roomLanding.edit.remove', { name: featureLabel(feature) })}
                      onRemove={block.features.length > 1 ? () => onChange({ ...block, features: block.features.filter((f) => f !== feature) }) : undefined}
                    />
                  </Group>
                )}
              </SortableItem>
            ))}
          </SortableList>
          <Picker
            opened={picker === 'features'}
            onClose={closePicker}
            title={t('roomLanding.edit.addFeature')}
            target={
              <Button size="compact-sm" variant="subtle" leftSection={<PlusIcon size={14} />} onClick={() => setPicker('features')}>
                {t('roomLanding.edit.addFeature')}
              </Button>
            }
          >
            <FeaturePickerList
              features={block.features}
              onChange={(features) => {
                if (block.features.length === 0) setPicker(null);
                onChange({ ...block, features });
              }}
            />
          </Picker>
        </>
      )}
      {children}
      {tool && (
        <>
          {!tool.visible && (
            <Badge variant="light" color="gray" title={t('roomLanding.tool.draftHint')}>
              {t('roomLanding.tool.draft')}
            </Badge>
          )}
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={tool.onToggleVisible}
            aria-label={tool.visible ? t('roomLanding.tool.hide') : t('roomLanding.tool.show')}
            title={tool.visible ? t('roomLanding.tool.hide') : t('roomLanding.tool.show')}
          >
            {tool.visible ? <EyeIcon size={16} /> : <EyeSlashIcon size={16} />}
          </ActionIcon>
        </>
      )}
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label={t('roomLanding.edit.blockMenu')} ml="auto">
            <DotsThreeVerticalIcon size={18} weight="bold" />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            onClick={() => onChange({ ...block, collapsed: !block.collapsed })}
            leftSection={block.collapsed ? <CheckIcon size={14} aria-hidden="true" /> : <Box w={14} />}
          >
            {t('roomLanding.edit.collapsed')}
          </Menu.Item>
          <Menu.Item color="danger" onClick={onDelete}>
            {t('roomLanding.edit.deleteBlock')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

/** The heading, edited in place: click, type, Enter (Esc keeps the old one). Empty means "named after its source". */
function HeadingEditor({ heading, placeholder, onSave }: { heading: string | null; placeholder: string; onSave: (heading: string | null) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    const save = () => {
      const clean = draft.trim();
      setDraft(null);
      if ((clean || null) !== heading) onSave(clean || null);
    };
    return (
      <TextInput
        autoFocus
        size="xs"
        aria-label={t('roomLanding.edit.heading')}
        placeholder={placeholder}
        value={draft}
        maxLength={100}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save();
          if (event.key === 'Escape') setDraft(null);
        }}
        w={220}
      />
    );
  }
  return (
    <UnstyledButton onClick={() => setDraft(heading ?? '')} aria-label={t('roomLanding.edit.renameBlock', { name: heading ?? placeholder })} className="room-landing-heading">
      <Group gap={4} wrap="nowrap">
        <Text fw={600} fz="h4" c={heading ? undefined : 'dimmed'} style={{ fontFamily: 'var(--font-display)' }}>
          {heading ?? placeholder}
        </Text>
        <PencilSimpleIcon size={14} aria-hidden="true" />
      </Group>
    </UnstyledButton>
  );
}

/** A maps block's one chip: which maps it keeps. */
function MapKindChip({ mapKind, onChange }: { mapKind: BlockMapKind | null; onChange: (mapKind: BlockMapKind | null) => void }) {
  const { t } = useTranslation();
  const label = (kind: BlockMapKind | null) => t(kind ? `roomLanding.mapKinds.${kind}` : 'roomLanding.mapKinds.all');
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <Button size="compact-sm" variant="light" rightSection={<CaretDownIcon size={12} />} aria-label={t('roomLanding.edit.mapKind', { kind: label(mapKind) })}>
          {label(mapKind)}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {([null, 'geographic', 'free'] as const).map((kind) => (
          <Menu.Item key={kind ?? 'all'} onClick={() => kind !== mapKind && onChange(kind)} fw={kind === mapKind ? 700 : undefined}>
            {label(kind)}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * The groups popover (spec 55 Decision 15): the groups as chips, one per
 * line since their order is the page's order, dragged to reorder, × to
 * remove; "+ Gruppo" ticks one or more Tags (several make a combination);
 * "Usa i raggruppamenti della Stanza" copies the Room's Main items.
 */
export function GroupsEditor({ groups, tags, mainItems, onChange }: { groups: string[][]; tags: Tag[]; mainItems: MainItem[]; onChange: (groups: string[][]) => void }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState<string[] | null>(null);
  const key = (group: string[]) => group.join('+');
  const exists = (group: string[]) => groups.some((other) => sameTagSet(other, group));
  const roomGroups = mainItems.map((item) => item.tagIds).filter((group) => tagsOf(group, tags).length === group.length);

  return (
    <Stack gap="sm">
      {groups.length === 0 ? (
        <Text size="xs" c="dimmed">
          {t('roomLanding.edit.noGroups')}
        </Text>
      ) : (
        <Stack gap={4} align="flex-start">
          <SortableList
            ids={groups.map(key)}
            onMove={(ids) => onChange(ids.map((id) => groups.find((group) => key(group) === id)!))}
          >
            {groups.map((group) => (
              <SortableItem key={key(group)} id={key(group)}>
                {({ ref, style }) => (
                  <Group ref={ref} style={style} gap={0} wrap="nowrap">
                    <DragHandle size="xs" label={t('roomLanding.edit.dragGroup', { name: groupLabel(group, tags) })} />
                    <Chip
                      label={groupLabel(group, tags)}
                      removeLabel={t('roomLanding.edit.remove', { name: groupLabel(group, tags) })}
                      onRemove={() => onChange(groups.filter((other) => other !== group))}
                    />
                  </Group>
                )}
              </SortableItem>
            ))}
          </SortableList>
        </Stack>
      )}
      {adding === null ? (
        <Group gap="xs" wrap="wrap">
          <Button size="compact-sm" variant="subtle" leftSection={<PlusIcon size={14} />} onClick={() => setAdding([])} disabled={groups.length >= 20}>
            {t('roomLanding.edit.addGroup')}
          </Button>
          {roomGroups.length > 0 && (
            <Button size="compact-sm" variant="subtle" color="gray" onClick={() => onChange(roomGroups)}>
              {t('roomLanding.edit.useRoomGroups')}
            </Button>
          )}
        </Group>
      ) : (
        <Stack gap={6}>
          <Text size="xs" c="dimmed">
            {t('roomLanding.edit.groupHint')}
          </Text>
          <ScrollArea.Autosize mah={200}>
            <Stack gap={4}>
              {tags.map((tag) => (
                <Checkbox
                  key={tag.id}
                  size="xs"
                  label={`#${tag.name}`}
                  checked={adding.includes(tag.id)}
                  onChange={() => setAdding(adding.includes(tag.id) ? adding.filter((id) => id !== tag.id) : [...adding, tag.id])}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
          <Group gap="xs" justify="flex-end">
            <Button size="compact-sm" variant="subtle" color="gray" onClick={() => setAdding(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="compact-sm"
              disabled={adding.length === 0 || exists(adding)}
              onClick={() => {
                onChange([...groups, adding]);
                setAdding(null);
              }}
            >
              {t('common.add')}
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
