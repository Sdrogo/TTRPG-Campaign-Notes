import { useState } from 'react';
import { Alert, Button, Input, Modal, SegmentedControl, Stack, Switch, Textarea, TextInput } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { Member } from '../../types/member';
import type { MapFormValues, MapKind } from '../../types/map';
import { MemberMultiSelect } from '../MemberMultiSelect';
import { VisibilitySelect } from '../VisibilitySelect';

/** The backend's limits on a map's name and description. */
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;

interface MapFormModalProps {
  title: string;
  initialValues: MapFormValues;
  members: Member[];
  /** The map's creator, who always sees it and so isn't offered for a grant. */
  creatorId: string;
  submitLabel: string;
  submitting: boolean;
  /** Offers the choice of a free board or a geographic map, on create only (spec 38 Decision 1). */
  kindChoice?: boolean;
  error: string | null;
  onSubmit: (values: MapFormValues) => void;
  onClose: () => void;
}

/**
 * A map's name, description and who sees it (spec 28 Decisions 1, 3): the
 * Comment levels, the creator standing for the Owner. Used to create a map
 * and for its settings; mounted while open, so it starts from
 * `initialValues`. In the settings (`playersCanEdit` given) it also holds
 * the switch that lets every member who sees the map edit it (spec 42).
 */
export function MapFormModal({
  title,
  initialValues,
  members,
  creatorId,
  submitLabel,
  submitting,
  kindChoice = false,
  error,
  onSubmit,
  onClose,
}: MapFormModalProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState(initialValues);
  const set = (patch: Partial<MapFormValues>) => setValues((current) => ({ ...current, ...patch }));

  return (
    <Modal opened onClose={onClose} title={title} centered>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <Stack gap="sm">
          {kindChoice && (
            <Input.Wrapper
              label={t('maps.kind.label')}
              description={values.kind === 'geographic' ? t('maps.kind.geographicHelp') : t('maps.kind.freeHelp')}
            >
              <SegmentedControl
                fullWidth
                mt={4}
                value={values.kind ?? 'free'}
                onChange={(kind) => set({ kind: kind as MapKind })}
                data={[
                  { value: 'free', label: t('maps.kind.free') },
                  { value: 'geographic', label: t('maps.kind.geographic') },
                ]}
              />
            </Input.Wrapper>
          )}
          <TextInput
            spellCheck
            label={t('common.name')}
            value={values.name}
            onChange={(event) => set({ name: event.currentTarget.value })}
            maxLength={MAX_NAME_LENGTH}
            required
            data-autofocus
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
          <VisibilitySelect
            label={t('visibility.label')}
            subject="comment"
            value={values.visibility}
            onChange={(visibility) => set({ visibility })}
          />
          {values.visibility === 'selective' && (
            <MemberMultiSelect
              label={t('maps.selectiveLabel')}
              members={members}
              excludeUserIds={[creatorId]}
              value={values.selectiveUserIds}
              onChange={(selectiveUserIds) => set({ selectiveUserIds })}
            />
          )}
          {values.playersCanEdit !== undefined && (
            <Switch
              label={t('maps.playersCanEdit')}
              description={t('maps.playersCanEditHelp')}
              checked={values.playersCanEdit}
              onChange={(event) => set({ playersCanEdit: event.currentTarget.checked })}
            />
          )}
          {error && <Alert color="red">{error}</Alert>}
          <Button type="submit" loading={submitting} disabled={!values.name.trim()}>
            {submitLabel}
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
