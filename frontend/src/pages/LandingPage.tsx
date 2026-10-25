import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Anchor, Box, Button, Card, Container, Group, Image, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import {
  ChatsCircleIcon,
  ExportIcon,
  EyeSlashIcon,
  MapTrifoldIcon,
  ScrollIcon,
  UsersThreeIcon,
  type Icon,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { LanguageSelector } from '../components/LanguageSelector';
import { SignInButtons } from '../components/SignInButtons';

/** The anchor of the sign-in block; `SignInRequired` links to `/#sign-in`. */
const SIGN_IN_ANCHOR = 'sign-in';

const FEATURES: readonly { key: 'rooms' | 'documents' | 'visibility' | 'comments' | 'maps' | 'export'; icon: Icon }[] = [
  { key: 'rooms', icon: UsersThreeIcon },
  { key: 'documents', icon: ScrollIcon },
  { key: 'visibility', icon: EyeSlashIcon },
  { key: 'comments', icon: ChatsCircleIcon },
  { key: 'maps', icon: MapTrifoldIcon },
  { key: 'export', icon: ExportIcon },
];

const STEPS = ['create', 'invite', 'write'] as const;

function scrollToSignIn() {
  document.getElementById(SIGN_IN_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** The bar a visitor without a session sees: logo and name, language, sign in. */
function LandingTopBar() {
  const { t } = useTranslation();
  return (
    <Box component="header" px={{ base: 'sm', sm: 'lg', lg: 'xl' }} py="sm">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Image src="/favicon.svg" alt="" w={32} h={32} />
          <Title order={3} lineClamp={1}>
            {t('app.name')}
          </Title>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <LanguageSelector />
          <Button variant="default" size="sm" onClick={scrollToSignIn}>
            {t('landing.signIn')}
          </Button>
        </Group>
      </Group>
    </Box>
  );
}

interface LandingPageProps {
  /** Whether someone is signed in: they get the app header and "Open my Rooms" instead of sign-in. */
  signedIn: boolean;
}

/**
 * `/`, for everyone (spec 45_1): what Ex Libris is, what it does, how to
 * start, and sign-in, or the way to the Rooms once signed in. A link to
 * `/#sign-in` lands on the sign-in block.
 */
export function LandingPage({ signedIn }: LandingPageProps) {
  const { t } = useTranslation();
  const { hash } = useLocation();

  useEffect(() => {
    if (hash === `#${SIGN_IN_ANCHOR}`) scrollToSignIn();
  }, [hash]);

  return (
    <>
      {signedIn ? <AppHeader /> : <LandingTopBar />}
      <Container component="main" size="lg" px={{ base: 'md', sm: 'lg' }} pb="xl">
        <Stack gap={64}>
          <Stack component="section" align="center" gap="md" pt={{ base: 'xl', sm: 64 }} ta="center">
            <Image src="/favicon.svg" alt="" w={96} h={96} />
            <Title order={1} fz={{ base: 40, sm: 56 }}>
              {t('app.name')}
            </Title>
            <Text fz="xl">{t('landing.tagline')}</Text>
            <Text c="dimmed" maw={640}>
              {t('landing.intro')}
            </Text>
            <Group justify="center" gap="sm">
              {/* A plain link: entering the Demo is a full page load (spec 45_2). */}
              <Button component="a" href="/demo" size="md">
                {t('landing.tryDemo')}
              </Button>
              {signedIn ? (
                <Button component={Link} to="/rooms" size="md" variant="default">
                  {t('landing.openMyRooms')}
                </Button>
              ) : (
                <Button size="md" variant="default" onClick={scrollToSignIn}>
                  {t('landing.signIn')}
                </Button>
              )}
            </Group>
          </Stack>

          <Stack component="section" gap="lg" aria-labelledby="landing-features">
            <Title order={2} id="landing-features" ta="center">
              {t('landing.featuresTitle')}
            </Title>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
              {FEATURES.map(({ key, icon: FeatureIcon }) => (
                <Card key={key} withBorder radius="md" p="lg">
                  <Stack gap="xs">
                    <FeatureIcon size={32} weight="duotone" color="var(--text-muted)" aria-hidden="true" />
                    <Title order={3} fz="h4">
                      {t(`landing.features.${key}.title`)}
                    </Title>
                    <Text size="sm" c="dimmed">
                      {t(`landing.features.${key}.text`)}
                    </Text>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
          </Stack>

          <Stack component="section" gap="lg" aria-labelledby="landing-steps">
            <Title order={2} id="landing-steps" ta="center">
              {t('landing.stepsTitle')}
            </Title>
            <SimpleGrid component="ol" cols={{ base: 1, sm: 3 }} spacing="md" p={0} m={0} style={{ listStyle: 'none' }}>
              {STEPS.map((step, index) => (
                <Group component="li" key={step} gap="md" wrap="nowrap" align="flex-start">
                  <Text fz={36} lh={1} c="dimmed" ff="var(--font-display)" aria-hidden="true">
                    {index + 1}
                  </Text>
                  <Text>{t(`landing.steps.${step}`)}</Text>
                </Group>
              ))}
            </SimpleGrid>
          </Stack>

          {!signedIn && (
            <Stack component="section" id={SIGN_IN_ANCHOR} align="center" gap="md" aria-labelledby="landing-sign-in">
              <Title order={2} id="landing-sign-in" ta="center">
                {t('landing.signInTitle')}
              </Title>
              <Text c="dimmed" ta="center">
                {t('auth.prompt')}
              </Text>
              <SignInButtons />
            </Stack>
          )}

          {/* The privacy notice is readable before signing in (spec 31_3). */}
          <Group component="footer" justify="center">
            <Anchor component={Link} to="/privacy" size="sm" c="dimmed">
              {t('auth.privacy')}
            </Anchor>
          </Group>
        </Stack>
      </Container>
    </>
  );
}
