import { Button, Group, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  MAX_BIO_LENGTH,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_PRONOUNS_LENGTH,
  profileFormValues,
  tooLong,
} from '../../lib/profile';
import type { AccountProfile, ProfileFormValues } from '../../types/profile';
import { useTranslation } from 'react-i18next';

interface ProfileFormProps {
  profile: AccountProfile;
  /**
   * Call `onDone` with the saved profile: the form then shows it as saved
   * (trimmed by the backend) and treats it as clean.
   */
  onSubmit: (values: ProfileFormValues, onDone: (saved: AccountProfile) => void) => void;
  saving: boolean;
}

/**
 * Name, pronouns and description. Saved together with one button, enabled only
 * when something changed.
 */
export function ProfileForm({ profile, onSubmit, saving }: ProfileFormProps) {
  const { t } = useTranslation();
  const form = useForm<ProfileFormValues>({
    initialValues: profileFormValues(profile),
    validate: {
      displayName: tooLong(MAX_DISPLAY_NAME_LENGTH),
      pronouns: tooLong(MAX_PRONOUNS_LENGTH),
      bio: tooLong(MAX_BIO_LENGTH),
    },
  });
  const bioLength = form.values.bio.trim().length;

  return (
    <form
      onSubmit={form.onSubmit((values) =>
        onSubmit(values, (saved) => {
          const savedValues = profileFormValues(saved);
          form.setInitialValues(savedValues);
          form.setValues(savedValues);
          form.resetDirty(savedValues);
        }),
      )}
    >
      <Stack gap="md">
        <TextInput
          label={t('account.profile.displayName')}
          description={t('account.profile.displayNameDescription')}
          placeholder={profile.email ?? t('account.profile.displayNamePlaceholder')}
          {...form.getInputProps('displayName')}
        />
        <TextInput
          label={t('account.profile.pronouns')}
          placeholder={t('account.profile.pronounsPlaceholder')}
          {...form.getInputProps('pronouns')}
        />
        <Textarea
          label={t('common.description')}
          description={t('account.profile.bioDescription')}
          autosize
          minRows={3}
          maxRows={8}
          {...form.getInputProps('bio')}
        />
        <Text size="xs" c={bioLength > MAX_BIO_LENGTH ? 'red' : 'dimmed'} ta="right" mt={-10}>
          {bioLength}/{MAX_BIO_LENGTH}
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button
            variant="subtle"
            color="gray"
            disabled={!form.isDirty() || saving}
            onClick={() => form.reset()}
          >
            {t('account.profile.discardChanges')}
          </Button>
          <Button type="submit" loading={saving} disabled={!form.isDirty()}>
            {t('account.profile.save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
