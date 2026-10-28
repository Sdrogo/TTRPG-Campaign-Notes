import { useState } from 'react';
import { Badge, Button, Group, Modal, Paper, Select, Stack, Text, Tooltip } from '@mantine/core';
import { ArrowDownIcon, ArrowUpIcon, CaretRightIcon, LockSimpleIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LabeledActionIcon } from '../LabeledActionIcon';
import { DEFAULT_CHAIN, MAX_MODULES, MODULE_KINDS, boardWrites, moduleLabel } from '../../lib/sessionZero';
import type { ModuleKind, SessionZeroModule } from '../../types/sessionZero';
import { useBoard } from './boardContext';

interface ChainRowsProps {
  kinds: ModuleKind[];
  disabled?: boolean;
  onMove: (index: number, to: number) => void;
  onRemove: (index: number) => void;
  onAdd: (kind: ModuleKind) => void;
}

/**
 * A chain's steps, one per line with "Move up", "Move down" and "Remove",
 * and "Add step" below (spec 47 Decisions 2 and 3; arrows rather than a
 * drag, the same on a phone). The last step stays: a session has at least
 * one.
 */
function ChainRows({ kinds, disabled = false, onMove, onRemove, onAdd }: ChainRowsProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ModuleKind>('retro');
  const full = kinds.length >= MAX_MODULES;
  return (
    <Stack gap={6}>
      {kinds.map((step, index) => (
        <Paper key={index} withBorder radius="sm" px="xs" py={4}>
          <Group justify="space-between" wrap="nowrap" gap={4}>
            <Text size="sm">
              {index + 1}. {moduleLabel(step)}
            </Text>
            <Group gap={2} wrap="nowrap">
              <LabeledActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t('sessionZero.modules.moveUp')}
                disabled={disabled || index === 0}
                onClick={() => onMove(index, index - 1)}
              >
                <ArrowUpIcon size={14} />
              </LabeledActionIcon>
              <LabeledActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t('sessionZero.modules.moveDown')}
                disabled={disabled || index === kinds.length - 1}
                onClick={() => onMove(index, index + 1)}
              >
                <ArrowDownIcon size={14} />
              </LabeledActionIcon>
              <LabeledActionIcon
                variant="subtle"
                color="red"
                size="sm"
                aria-label={t('sessionZero.modules.remove')}
                disabled={disabled || kinds.length === 1}
                onClick={() => onRemove(index)}
              >
                <TrashIcon size={14} />
              </LabeledActionIcon>
            </Group>
          </Group>
        </Paper>
      ))}
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <Select
          size="xs"
          label={t('sessionZero.modules.kind')}
          allowDeselect={false}
          value={kind}
          data={MODULE_KINDS.map((value) => ({ value, label: moduleLabel(value) }))}
          onChange={(value) => setKind(value as ModuleKind)}
          style={{ flex: 1 }}
        />
        <Button
          size="xs"
          variant="default"
          leftSection={<PlusIcon size={14} />}
          disabled={disabled || full}
          onClick={() => onAdd(kind)}
        >
          {t('sessionZero.modules.add')}
        </Button>
      </Group>
      {full && (
        <Text size="xs" c="dimmed">
          {t('sessionZero.modules.max', { max: MAX_MODULES })}
        </Text>
      )}
    </Stack>
  );
}

/** `items` with the one at `index` moved to `to`. */
function moved<T>(items: T[], index: number, to: number): T[] {
  const next = items.filter((_, other) => other !== index);
  next.splice(to, 0, items[index]);
  return next;
}

interface ChainEditorProps {
  value: ModuleKind[];
  onChange: (kinds: ModuleKind[]) => void;
}

/** A chain being composed, before the session exists: nothing is sent until "Start" or "Create". */
export function ChainEditor({ value, onChange }: ChainEditorProps) {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>
        {t('sessionZero.modules.chain')}
      </Text>
      <Text size="xs" c="dimmed">
        {t('sessionZero.modules.chainHint')}
      </Text>
      <ChainRows
        kinds={value}
        onMove={(index, to) => onChange(moved(value, index, to))}
        onRemove={(index) => onChange(value.filter((_, other) => other !== index))}
        onAdd={(kind) => onChange([...value, kind])}
      />
    </Stack>
  );
}

interface StartSessionZeroProps {
  canManage: boolean;
  busy: boolean;
  onStart: (modules?: ModuleKind[]) => void;
}

/**
 * "Start Session 0" (spec 47 Decision 2): the Master composes the first
 * session's chain in a dialog, Retro + Lines & Veils proposed; a Player
 * starts it at once with that default.
 */
export function StartSessionZero({ canManage, busy, onStart }: StartSessionZeroProps) {
  const { t } = useTranslation();
  const [composing, setComposing] = useState(false);
  const [chain, setChain] = useState<ModuleKind[]>(DEFAULT_CHAIN);
  return (
    <>
      <Button disabled={busy} onClick={() => (canManage ? setComposing(true) : onStart())}>
        {t('sessionZero.start')}
      </Button>
      {composing && (
        <Modal opened onClose={() => setComposing(false)} title={t('sessionZero.start')} centered>
          <Stack>
            <ChainEditor value={chain} onChange={setChain} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setComposing(false)}>
                {t('common.cancel')}
              </Button>
              <Button disabled={busy} onClick={() => onStart(chain)}>
                {t('sessionZero.modules.startButton')}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </>
  );
}

interface ModuleStepperProps {
  /** Opens a step on this viewer's screen only; null goes back to the current one. */
  onView: (moduleId: string | null) => void;
}

/**
 * The shown session's chain as a row of steps (spec 47 Decision 4), the
 * current one filled, the one on screen tinted; a click opens a step here
 * only. A Player sees the steps reached and a locked "+N" for the rest
 * (Decision 5). In the open session the Master has "Next", "Bring the table
 * here" while another step is on screen, and "Edit steps"; every member's
 * page follows the current step (Decision 4, the `module` event).
 */
export function ModuleStepper({ onView }: ModuleStepperProps) {
  const { t } = useTranslation();
  const { board, module: shown, act, busy, writable } = useBoard();
  const [editing, setEditing] = useState(false);
  const open = board.rounds.find((round) => round.id === board.roundId)?.closedAt === null;
  const manage = writable && open && board.canManage;
  const currentIndex = board.modules.findIndex((module) => module.id === board.currentModuleId);
  const next = currentIndex >= 0 ? board.modules[currentIndex + 1] : undefined;
  const elsewhere = shown !== undefined && shown.id !== board.currentModuleId;
  return (
    <Group component="nav" aria-label={t('sessionZero.modules.label')} gap={6} className="sz-steps">
      {board.modules.map((module, index) => {
        const current = module.id === board.currentModuleId;
        return (
          <Button
            key={module.id}
            size="compact-sm"
            variant={current ? 'filled' : module.id === shown?.id ? 'light' : 'default'}
            aria-current={current ? 'step' : undefined}
            aria-pressed={module.id === shown?.id}
            title={current ? t('sessionZero.modules.current') : undefined}
            onClick={() => onView(current ? null : module.id)}
          >
            {index + 1}. {moduleLabel(module.kind)}
          </Button>
        );
      })}
      {board.hiddenModules > 0 && (
        <Tooltip label={t('sessionZero.modules.hiddenHint', { count: board.hiddenModules })} withArrow>
          <Badge color="gray" variant="light" tabIndex={0} leftSection={<LockSimpleIcon size={12} />}>
            +{board.hiddenModules}
          </Badge>
        </Tooltip>
      )}
      {manage && (
        <Group gap={6} wrap="nowrap" ml="auto">
          {elsewhere ? (
            <Button size="compact-sm" disabled={busy} onClick={() => act(boardWrites.setCurrentModule(shown.id))}>
              {t('sessionZero.modules.bringHere')}
            </Button>
          ) : (
            next && (
              <Button
                size="compact-sm"
                rightSection={<CaretRightIcon size={14} />}
                disabled={busy}
                onClick={() => act(boardWrites.setCurrentModule(next.id))}
              >
                {t('sessionZero.modules.next')}
              </Button>
            )
          )}
          <Button size="compact-sm" variant="subtle" color="gray" onClick={() => setEditing(true)}>
            {t('sessionZero.modules.edit')}
          </Button>
        </Group>
      )}
      {editing && <EditStepsModal onClose={() => setEditing(false)} />}
    </Group>
  );
}

/**
 * "Edit steps" (spec 47 Decision 3): the open session's chain, each change
 * sent at once. Removing a step that holds post-its asks first, since they
 * go with it; Lines & Veils is the Room's and never goes.
 */
function EditStepsModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { board, act, busy } = useBoard();
  const [removing, setRemoving] = useState<SessionZeroModule | null>(null);
  const ids = board.modules.map((module) => module.id);
  const remove = (module: SessionZeroModule) => act(boardWrites.removeModule(module.id), () => setRemoving(null));
  return (
    <Modal opened onClose={onClose} title={t('sessionZero.modules.edit')} centered>
      {removing ? (
        <Stack>
          <Text fw={600}>{t('sessionZero.modules.removeTitle')}</Text>
          <Text size="sm">{t('sessionZero.modules.removeBody', { name: moduleLabel(removing.kind) })}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </Button>
            <Button color="red" disabled={busy} onClick={() => remove(removing)}>
              {t('sessionZero.modules.remove')}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack>
          <Text size="xs" c="dimmed">
            {t('sessionZero.modules.editHint')}
          </Text>
          <ChainRows
            kinds={board.modules.map((module) => module.kind)}
            disabled={busy}
            onMove={(index, to) => act(boardWrites.reorderModules(moved(ids, index, to)))}
            onRemove={(index) => {
              const module = board.modules[index];
              if (module.columns.some((column) => column.cards.length > 0)) setRemoving(module);
              else remove(module);
            }}
            onAdd={(kind) => act(boardWrites.addModule(kind))}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('common.close')}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
