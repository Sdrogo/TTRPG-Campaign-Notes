import { useState } from 'react';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Group,
  Input,
  Modal,
  MultiSelect,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import {
  BUILT_IN_TEMPLATES,
  MAX_CLOSING_LENGTH,
  MAX_CONSEQUENCE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LABELS_PER_CLOCK,
  MAX_NAME_LENGTH,
  MAX_SEGMENTS,
  MAX_STAGE_LENGTH,
  MIN_SEGMENTS,
  SIZE_SHORTCUTS,
  builtInSettings,
  templateSettings,
} from '../../lib/clocks';
import { colorValue } from '../../lib/maps';
import { notifyError } from '../../lib/notify';
import { useCreateLabel, useCreateTemplate } from '../../hooks/useClocks';
import type { ClockFormValues, ClockRules, ClockSettings, MarkPolicy } from '../../types/clock';
import type { Document } from '../../types/document';
import type { Member } from '../../types/member';
import { MapColorPicker } from '../maps/MapColorPicker';
import { MemberMultiSelect } from '../MemberMultiSelect';
import { VisibilitySelect } from '../VisibilitySelect';

/**
 * A clock's dialog (spec 61 Decisions 3, 4, 6): templates on create, name,
 * size (2-16, odd too; 4, 6, 8, 12 are shortcuts), colour from the map
 * palette, the Room's labels (the Master types a new one: "Crea «…»"),
 * closing condition, stages, the Master's consequence, the linked
 * Document, who sees and who marks it, "Solo avanti". A Player proposing or
 * opening a clock sees no Master-only field. Mounted while open, so it
 * starts from `initialValues`.
 */
export function ClockDialog({
  roomId,
  title,
  submitLabel,
  initialValues,
  rules,
  isMaster,
  isCreate,
  documents,
  members,
  creatorId,
  submitting,
  error,
  onSubmit,
  onClose,
}: {
  roomId: string;
  title: string;
  submitLabel: string;
  initialValues: ClockFormValues;
  rules: ClockRules;
  isMaster: boolean;
  /** Offers the templates (a new clock only). */
  isCreate: boolean;
  documents: Document[];
  members: Member[];
  creatorId: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (values: ClockFormValues) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initialValues);
  const [template, setTemplate] = useState<string | null>(null);
  const [stagesOpen, setStagesOpen] = useState(initialValues.stageLabels.length > 0);
  const [labelSearch, setLabelSearch] = useState('');
  const [templateName, setTemplateName] = useState<string | null>(null);
  const createLabel = useCreateLabel(roomId);
  const createTemplate = useCreateTemplate(roomId);
  const set = (patch: Partial<ClockFormValues>) => setValues((current) => ({ ...current, ...patch }));
  const applySettings = (settings: ClockSettings, key: string, masterOnly = false) => {
    setTemplate(key);
    setStagesOpen(settings.stageLabels.length > 0);
    set({
      ...settings,
      consequence: isMaster ? settings.consequence : null,
      ...(masterOnly && isMaster ? { visibility: 'master' as const } : {}),
    });
  };

  const search = labelSearch.trim();
  const canCreateLabel =
    isMaster &&
    search.length > 0 &&
    !rules.labels.some((label) => label.name.toLocaleLowerCase() === search.toLocaleLowerCase());
  const stageCount = Math.min(values.segments, MAX_SEGMENTS);
  const stages = Array.from({ length: stageCount }, (_, index) => values.stageLabels[index] ?? '');

  return (
    <Modal opened onClose={onClose} closeOnClickOutside={false} title={title} size="xl" centered>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <Stack gap="md">
          {isCreate && (
            <Input.Wrapper label={t('clocks.dialog.templates')}>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mt={4} role="radiogroup">
                {BUILT_IN_TEMPLATES.map((builtIn) => (
                  <TemplateTile
                    key={builtIn.key}
                    name={t(`clocks.templates.${builtIn.key}.name`)}
                    detail={t(`clocks.templates.${builtIn.key}.detail`)}
                    color={builtIn.color}
                    selected={template === builtIn.key}
                    onClick={() => applySettings(builtInSettings(builtIn), builtIn.key, builtIn.masterOnly)}
                  />
                ))}
                {rules.templates.map((own) => (
                  <TemplateTile
                    key={own.id}
                    name={own.name}
                    detail={t('clocks.dialog.roomTemplate', { segments: own.settings.segments })}
                    color={own.settings.color}
                    selected={template === own.id}
                    dashed
                    onClick={() => applySettings(templateSettings(own, rules.labels), own.id)}
                  />
                ))}
              </SimpleGrid>
            </Input.Wrapper>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput
              spellCheck
              label={t('common.name')}
              description={t('clocks.dialog.nameHint')}
              value={values.name}
              onChange={(event) => set({ name: event.currentTarget.value })}
              maxLength={MAX_NAME_LENGTH}
              required
              data-autofocus
            />
            <Input.Wrapper label={t('clocks.dialog.size')} description={t('clocks.dialog.sizeHint')}>
              <Group gap="xs" mt={4} wrap="wrap">
                <NumberInput
                  aria-label={t('clocks.dialog.size')}
                  value={values.segments}
                  min={MIN_SEGMENTS}
                  max={MAX_SEGMENTS}
                  step={1}
                  clampBehavior="strict"
                  allowDecimal={false}
                  w={96}
                  onChange={(value) => typeof value === 'number' && set({ segments: value })}
                />
                {SIZE_SHORTCUTS.map((size) => (
                  <Button
                    key={size}
                    size="compact-sm"
                    variant={values.segments === size ? 'light' : 'default'}
                    onClick={() => set({ segments: size })}
                    aria-pressed={values.segments === size}
                  >
                    {size}
                  </Button>
                ))}
              </Group>
            </Input.Wrapper>
          </SimpleGrid>
          <MapColorPicker value={values.color} onChange={(color) => set({ color })} />
          <Stack gap={4}>
            <MultiSelect
              label={t('clocks.dialog.labels')}
              description={isMaster ? t('clocks.dialog.labelsHintMaster') : t('clocks.dialog.labelsHint')}
              data={rules.labels.map((label) => ({ value: label.id, label: label.name }))}
              value={values.labelIds}
              onChange={(labelIds) => set({ labelIds })}
              searchable
              searchValue={labelSearch}
              onSearchChange={setLabelSearch}
              maxValues={MAX_LABELS_PER_CLOCK}
              nothingFoundMessage={canCreateLabel ? undefined : t('clocks.dialog.noLabels')}
              renderOption={({ option }) => {
                // The options are the Room's labels, so each one is found.
                const label = rules.labels.find((other) => other.id === option.value)!;
                return (
                  <Group gap={8} wrap="nowrap">
                    <span
                      aria-hidden="true"
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 2,
                        background: colorValue(label.color),
                      }}
                    />
                    {option.label}
                  </Group>
                );
              }}
            />
            {canCreateLabel && values.labelIds.length < MAX_LABELS_PER_CLOCK && (
              <Anchor
                component="button"
                type="button"
                size="sm"
                w="fit-content"
                // Keeps the picker's focus, or its blur clears the search and this link with it.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  createLabel.mutate(
                    { name: search, color: values.color },
                    {
                      onError: notifyError,
                      onSuccess: (label) => {
                        set({ labelIds: [...values.labelIds, label.id] });
                        setLabelSearch('');
                      },
                    },
                  )
                }
              >
                {t('clocks.dialog.createLabel', { name: search })}
              </Anchor>
            )}
          </Stack>
          <TextInput
            spellCheck
            label={t('clocks.dialog.closingCondition')}
            description={t('clocks.dialog.closingConditionHint')}
            value={values.closingCondition ?? ''}
            onChange={(event) => set({ closingCondition: event.currentTarget.value })}
            maxLength={MAX_CLOSING_LENGTH}
          />
          <Textarea
            spellCheck
            label={t('common.description')}
            value={values.description}
            onChange={(event) => set({ description: event.currentTarget.value })}
            maxLength={MAX_DESCRIPTION_LENGTH}
            autosize
            minRows={2}
          />
          <Stack gap={4}>
            <Anchor
              component="button"
              type="button"
              size="sm"
              w="fit-content"
              aria-expanded={stagesOpen}
              onClick={() => setStagesOpen((open) => !open)}
            >
              {stagesOpen ? t('clocks.dialog.stagesHide') : t('clocks.dialog.stagesShow')}
            </Anchor>
            <Collapse expanded={stagesOpen}>
              <Stack gap={6}>
                <Text size="xs" c="dimmed">
                  {t('clocks.dialog.stagesHint')}
                </Text>
                {stages.map((stage, index) => (
                  <TextInput
                    key={index}
                    size="xs"
                    label={t('clocks.dialog.stage', { number: index + 1 })}
                    value={stage}
                    maxLength={MAX_STAGE_LENGTH}
                    onChange={(event) => {
                      const next = [...stages];
                      next[index] = event.currentTarget.value;
                      set({ stageLabels: next });
                    }}
                  />
                ))}
              </Stack>
            </Collapse>
          </Stack>
          {isMaster && (
            <Textarea
              spellCheck
              className="clock-dialog-master-only"
              label={
                <Group gap={6} component="span">
                  {t('clocks.dialog.consequence')}
                  <Badge size="xs" color="yellow" variant="light">
                    {t('clocks.dialog.masterOnly')}
                  </Badge>
                </Group>
              }
              value={values.consequence ?? ''}
              onChange={(event) => set({ consequence: event.currentTarget.value })}
              maxLength={MAX_CONSEQUENCE_LENGTH}
              autosize
              minRows={2}
            />
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <Select
              label={t('clocks.dialog.document')}
              placeholder={t('clocks.dialog.noDocument')}
              data={documents.map((document) => ({ value: document.id, label: document.name }))}
              value={values.documentId}
              onChange={(documentId) => set({ documentId })}
              searchable
              clearable
            />
            <Select
              label={t('clocks.dialog.markPolicy')}
              data={[
                {
                  value: 'room',
                  label: t('clocks.dialog.markPolicyRoom', {
                    rule: t(`clocks.markPolicy.${rules.markPolicy}`),
                  }),
                },
                ...(['master', 'master_and_creator', 'everyone'] as const).map((policy) => ({
                  value: policy,
                  label: t(`clocks.markPolicy.${policy}`),
                })),
              ]}
              value={values.markPolicy ?? 'room'}
              onChange={(policy) =>
                set({ markPolicy: !policy || policy === 'room' ? null : (policy as MarkPolicy) })
              }
              allowDeselect={false}
            />
            <VisibilitySelect
              label={t('visibility.label')}
              subject="comment"
              value={values.visibility}
              onChange={(visibility) => set({ visibility })}
            />
            {rules.allowUnmark && (
              <Checkbox
                mt={{ sm: 28 }}
                label={t('clocks.dialog.forwardOnly')}
                description={t('clocks.dialog.forwardOnlyHint')}
                checked={values.forwardOnly}
                onChange={(event) => set({ forwardOnly: event.currentTarget.checked })}
              />
            )}
          </SimpleGrid>
          {values.visibility === 'selective' && (
            <MemberMultiSelect
              label={t('clocks.dialog.selectiveLabel')}
              members={members}
              excludeUserIds={[creatorId]}
              value={values.selectiveUserIds}
              onChange={(selectiveUserIds) => set({ selectiveUserIds })}
            />
          )}
          {error && <Alert color="danger">{error}</Alert>}
          {templateName !== null && (
            <Group gap="xs" align="flex-end">
              <TextInput
                label={t('clocks.dialog.templateName')}
                value={templateName}
                maxLength={MAX_NAME_LENGTH}
                onChange={(event) => setTemplateName(event.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <Button
                variant="default"
                loading={createTemplate.isPending}
                disabled={!templateName.trim()}
                onClick={() =>
                  createTemplate.mutate(
                    { name: templateName, settings: { ...values, stageLabels: stages } },
                    { onError: notifyError, onSuccess: () => setTemplateName(null) },
                  )
                }
              >
                {t('common.save')}
              </Button>
            </Group>
          )}
          <Group justify="flex-end" gap="sm">
            {isMaster && templateName === null && (
              <Button variant="subtle" color="gray" onClick={() => setTemplateName(values.name)}>
                {t('clocks.dialog.saveTemplate')}
              </Button>
            )}
            <Button variant="subtle" color="gray" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={submitting} disabled={!values.name.trim()}>
              {submitLabel}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** A template's tile: a small face in its colour, its name and what it is. */
function TemplateTile({
  name,
  detail,
  color,
  selected,
  dashed = false,
  onClick,
}: {
  name: string;
  detail: string;
  color: ClockSettings['color'];
  selected: boolean;
  dashed?: boolean;
  onClick: () => void;
}) {
  return (
    <UnstyledButton
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className="clock-template-tile"
      data-selected={selected || undefined}
      data-dashed={dashed || undefined}
    >
      <Group gap={10} wrap="nowrap">
        <span
          aria-hidden="true"
          className="clock-template-dot"
          style={{ background: colorValue(color) }}
        />
        <Stack gap={0}>
          <Text size="sm" fw={600} lineClamp={2}>
            {name}
          </Text>
          <Text size="xs" c="dimmed">
            {detail}
          </Text>
        </Stack>
      </Group>
    </UnstyledButton>
  );
}
