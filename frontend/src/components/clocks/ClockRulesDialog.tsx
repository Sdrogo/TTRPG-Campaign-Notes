import { useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Group,
  Input,
  Modal,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { FloppyDiskIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MAX_LABEL_NAME_LENGTH, MAX_MARK_KINDS, RULES_PRESETS, matchingPreset } from '../../lib/clocks';
import { MAP_COLORS, colorValue } from '../../lib/maps';
import { notifyError } from '../../lib/notify';
import {
  useCreateLabel,
  useCreateMarkKind,
  useDeleteLabel,
  useDeleteMarkKind,
  useDeleteTemplate,
  useSaveClockPolicies,
  useUpdateLabel,
  useUpdateMarkKind,
  type PoliciesInput,
  type RuleItemInput,
} from '../../hooks/useClocks';
import type { ClockLabel, ClockRules, KindWho, MarkKind, MarkPolicy, OpenPolicy } from '../../types/clock';
import type { MapColor } from '../../types/map';
import { LabeledActionIcon } from '../LabeledActionIcon';

const OPEN_POLICIES: OpenPolicy[] = ['master', 'everyone', 'propose'];
const MARK_POLICIES: MarkPolicy[] = ['master', 'master_and_creator', 'everyone'];
const KIND_WHO: KindWho[] = ['master', 'players', 'everyone'];
// The selects below take no deselect (`allowDeselect={false}`), so they never answer null.

/**
 * The Room's clock rules (spec 61 Decisions 1-3), the Master's: a preset
 * fills the three policies in one click (never labels or kinds), then who
 * opens, who marks and whether marks can be undone; the Room's labels and
 * mark kinds, each saved on its own row; the Room's templates.
 */
export function ClockRulesDialog({
  roomId,
  rules,
  onClose,
}: {
  roomId: string;
  rules: ClockRules;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [policies, setPolicies] = useState<PoliciesInput>({
    openPolicy: rules.openPolicy,
    markPolicy: rules.markPolicy,
    allowUnmark: rules.allowUnmark,
  });
  const savePolicies = useSaveClockPolicies(roomId);
  const deleteTemplate = useDeleteTemplate(roomId);
  const preset = matchingPreset(policies);
  const dirty =
    policies.openPolicy !== rules.openPolicy ||
    policies.markPolicy !== rules.markPolicy ||
    policies.allowUnmark !== rules.allowUnmark;

  return (
    <Modal opened onClose={onClose} closeOnClickOutside={false} title={t('clocks.rules.title')} size="lg" centered>
      <Stack gap="lg">
        <Stack gap="sm">
          <Input.Wrapper label={t('clocks.rules.presets')} description={t('clocks.rules.presetsHint')}>
            <Group gap="xs" mt={6} role="radiogroup">
              {RULES_PRESETS.map((option) => (
                <UnstyledButton
                  key={option.key}
                  role="radio"
                  aria-checked={preset?.key === option.key}
                  className="clock-template-tile"
                  data-selected={preset?.key === option.key || undefined}
                  onClick={() =>
                    setPolicies({
                      openPolicy: option.openPolicy,
                      markPolicy: option.markPolicy,
                      allowUnmark: option.allowUnmark,
                    })
                  }
                >
                  <Text size="sm" fw={600}>
                    {t(`clocks.presets.${option.key}.name`)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t(`clocks.presets.${option.key}.detail`)}
                  </Text>
                </UnstyledButton>
              ))}
            </Group>
          </Input.Wrapper>
          <Select
            label={t('clocks.rules.openPolicy')}
            data={OPEN_POLICIES.map((value) => ({ value, label: t(`clocks.openPolicy.${value}`) }))}
            value={policies.openPolicy}
            onChange={(value) => setPolicies((p) => ({ ...p, openPolicy: value as OpenPolicy }))}
            allowDeselect={false}
          />
          <Select
            label={t('clocks.rules.markPolicy')}
            data={MARK_POLICIES.map((value) => ({ value, label: t(`clocks.markPolicy.${value}`) }))}
            value={policies.markPolicy}
            onChange={(value) => setPolicies((p) => ({ ...p, markPolicy: value as MarkPolicy }))}
            allowDeselect={false}
          />
          <Radio.Group
            label={t('clocks.rules.undo')}
            value={policies.allowUnmark ? 'yes' : 'no'}
            onChange={(value) => setPolicies((p) => ({ ...p, allowUnmark: value === 'yes' }))}
          >
            <Stack gap={6} mt={6}>
              <Radio value="yes" label={t('clocks.rules.undoYes')} />
              <Radio value="no" label={t('clocks.rules.undoNo')} description={t('clocks.rules.undoNoHint')} />
            </Stack>
          </Radio.Group>
          {savePolicies.error && <Alert color="danger">{savePolicies.error.message}</Alert>}
          <Group justify="flex-end">
            <Button
              disabled={!dirty}
              loading={savePolicies.isPending}
              onClick={() => savePolicies.mutate(policies)}
            >
              {t('clocks.rules.save')}
            </Button>
          </Group>
        </Stack>
        <Divider />
        <RuleItems
          kind="label"
          roomId={roomId}
          title={t('clocks.rules.labels')}
          hint={t('clocks.rules.labelsHint')}
          items={rules.labels}
        />
        <Divider />
        <RuleItems
          kind="markKind"
          roomId={roomId}
          title={t('clocks.rules.markKinds')}
          hint={t('clocks.rules.markKindsHint')}
          items={rules.markKinds}
        />
        <Divider />
        <Stack gap="xs">
          <Title order={3} fz="h5">
            {t('clocks.rules.templates')}
          </Title>
          {rules.templates.length === 0 ? (
            <Text size="sm" c="dimmed">
              {t('clocks.rules.noTemplates')}
            </Text>
          ) : (
            rules.templates.map((template) => (
              <Group key={template.id} justify="space-between" wrap="nowrap">
                <Text size="sm">
                  {template.name}{' '}
                  <Text span size="xs" c="dimmed">
                    {t('clocks.dialog.roomTemplate', { segments: template.settings.segments })}
                  </Text>
                </Text>
                <LabeledActionIcon
                  variant="subtle"
                  color="danger"
                  size="sm"
                  aria-label={t('clocks.rules.deleteTemplate', { name: template.name })}
                  loading={deleteTemplate.isPending && deleteTemplate.variables === template.id}
                  onClick={() => deleteTemplate.mutate(template.id, { onError: notifyError })}
                >
                  <TrashIcon size={16} />
                </LabeledActionIcon>
              </Group>
            ))
          )}
        </Stack>
      </Stack>
    </Modal>
  );
}

/** The Room's labels or mark kinds: one row each, saved on its own, and a row to add one. */
function RuleItems({
  kind,
  roomId,
  title,
  hint,
  items,
}: {
  kind: 'label' | 'markKind';
  roomId: string;
  title: string;
  hint: string;
  items: (ClockLabel | MarkKind)[];
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const createLabel = useCreateLabel(roomId);
  const createKind = useCreateMarkKind(roomId);
  const create = kind === 'label' ? createLabel : createKind;
  const full = kind === 'markKind' && items.length >= MAX_MARK_KINDS;

  return (
    <Stack gap="xs">
      <Title order={3} fz="h5">
        {title}
      </Title>
      <Text size="xs" c="dimmed">
        {hint}
      </Text>
      {items.map((item) => (
        <RuleItemRow key={item.id} kind={kind} roomId={roomId} item={item} />
      ))}
      {adding ? (
        <RuleItemForm
          kind={kind}
          initial={{ name: '', color: 'default', who: 'everyone' }}
          submitLabel={t('common.add')}
          pending={create.isPending}
          onSubmit={(input) =>
            create.mutate(input, { onError: notifyError, onSuccess: () => setAdding(false) })
          }
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button
          variant="default"
          size="xs"
          w="fit-content"
          leftSection={<PlusIcon size={14} />}
          disabled={full}
          onClick={() => setAdding(true)}
        >
          {kind === 'label' ? t('clocks.rules.addLabel') : t('clocks.rules.addMarkKind')}
        </Button>
      )}
    </Stack>
  );
}

/** One saved label or mark kind: its fields, saved when changed, and its delete (confirmed for a label in use). */
function RuleItemRow({
  kind,
  roomId,
  item,
}: {
  kind: 'label' | 'markKind';
  roomId: string;
  item: ClockLabel | MarkKind;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const updateLabel = useUpdateLabel(roomId);
  const updateKind = useUpdateMarkKind(roomId);
  const deleteLabel = useDeleteLabel(roomId);
  const deleteKind = useDeleteMarkKind(roomId);
  const update = kind === 'label' ? updateLabel : updateKind;
  const remove = kind === 'label' ? deleteLabel : deleteKind;
  const uses = 'clockCount' in item ? (item.clockCount ?? 0) : 0;

  return (
    <>
      <RuleItemForm
        kind={kind}
        initial={{ name: item.name, color: item.color, who: 'who' in item ? item.who : undefined }}
        submitLabel={t('common.save')}
        pending={update.isPending}
        onSubmit={(input) => update.mutate({ ...input, id: item.id }, { onError: notifyError })}
        onDelete={() =>
          uses > 0 ? setConfirming(true) : remove.mutate(item.id, { onError: notifyError })
        }
        deleting={remove.isPending}
      />
      <Modal
        opened={confirming}
        onClose={() => setConfirming(false)}
        closeOnClickOutside={false}
        title={t('clocks.rules.deleteLabelTitle')}
        centered
      >
        <Stack gap="sm">
          <Text>{t('clocks.rules.deleteLabelBody', { name: item.name, count: uses })}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              color="danger"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(item.id, { onError: notifyError, onSuccess: () => setConfirming(false) })
              }
            >
              {t('common.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

/** A label's or mark kind's fields on one line: name, colour, and (a kind) who may use it. */
function RuleItemForm({
  kind,
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  onDelete,
  deleting = false,
}: {
  kind: 'label' | 'markKind';
  initial: RuleItemInput;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: RuleItemInput) => void;
  onCancel?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<RuleItemInput>(initial);
  const dirty =
    value.name !== initial.name || value.color !== initial.color || value.who !== initial.who;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <Group gap="xs" wrap="wrap" align="flex-end">
        <TextInput
          aria-label={t('common.name')}
          placeholder={t('common.name')}
          size="xs"
          value={value.name}
          maxLength={MAX_LABEL_NAME_LENGTH}
          onChange={(event) => {
            const name = event.currentTarget.value;
            setValue((v) => ({ ...v, name }));
          }}
          style={{ flex: '1 1 140px' }}
          required
        />
        <Select
          aria-label={t('maps.color')}
          size="xs"
          w={130}
          data={MAP_COLORS.map((color) => ({ value: color, label: t(`maps.colors.${color}`) }))}
          value={value.color}
          onChange={(color) => setValue((v) => ({ ...v, color: color as MapColor }))}
          allowDeselect={false}
          leftSection={
            <span
              aria-hidden="true"
              style={{ width: 10, height: 10, borderRadius: 2, background: colorValue(value.color) }}
            />
          }
        />
        {kind === 'markKind' && (
          <Select
            aria-label={t('clocks.rules.who')}
            size="xs"
            w={130}
            data={KIND_WHO.map((who) => ({ value: who, label: t(`clocks.who.${who}`) }))}
            value={value.who}
            onChange={(who) => setValue((v) => ({ ...v, who: who as KindWho }))}
            allowDeselect={false}
          />
        )}
        {(dirty || onCancel) && (
          <LabeledActionIcon
            type="submit"
            variant="light"
            size="md"
            aria-label={submitLabel}
            loading={pending}
            disabled={!value.name.trim()}
          >
            <FloppyDiskIcon size={16} />
          </LabeledActionIcon>
        )}
        {onCancel && (
          <Button variant="subtle" color="gray" size="xs" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        {onDelete && (
          <LabeledActionIcon
            variant="subtle"
            color="danger"
            size="md"
            aria-label={t('clocks.rules.deleteItem', { name: initial.name })}
            loading={deleting}
            onClick={onDelete}
          >
            <TrashIcon size={16} />
          </LabeledActionIcon>
        )}
      </Group>
    </form>
  );
}
