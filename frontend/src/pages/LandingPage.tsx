import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Anchor,
  Box,
  Button,
  Container,
  Group,
  Image,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
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
import type { TourStepId } from '../lib/demo/tour';

/** The anchor of the sign-in block; `SignInRequired` links to `/#sign-in`. */
const SIGN_IN_ANCHOR = 'sign-in';

// `tour`: the step of the Demo's tour that shows the feature (spec 45_3).
const FEATURES: readonly {
  key: 'rooms' | 'documents' | 'visibility' | 'comments' | 'maps' | 'export';
  icon: Icon;
  tour: TourStepId | null;
}[] = [
  { key: 'rooms', icon: UsersThreeIcon, tour: 'room' },
  { key: 'documents', icon: ScrollIcon, tour: 'document' },
  { key: 'visibility', icon: EyeSlashIcon, tour: 'visibility' },
  { key: 'comments', icon: ChatsCircleIcon, tour: 'comments' },
  { key: 'maps', icon: MapTrifoldIcon, tour: 'freeMap' },
  { key: 'export', icon: ExportIcon, tour: null },
];

const STEPS = ['create', 'invite', 'write'] as const;

function scrollToSignIn() {
  document.getElementById(SIGN_IN_ANCHOR)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** The bar a visitor without a session sees: logo and name, language, sign in. */
function LandingTopBar() {
  const { t } = useTranslation();
  return (
    <Box
      component="header"
      px={{ base: 'sm', sm: 'lg', lg: 'xl' }}
      py="sm"
      className="landing-topbar"
    >
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
      <Container component="main" size="xl" px={{ base: 'md', sm: 'xl' }} pb="xl">
        <Stack gap="xl" className="landing-sections">
          <Box component="section" className="landing-hero">
            <Stack gap="lg" className="landing-hero-copy">
              <Group gap="sm" wrap="nowrap" className="landing-wordmark">
                <Image src="/favicon.svg" alt="" w={40} h={40} />
                <Text tt="uppercase" fw={600} size="xs">
                  {t('app.name')}
                </Text>
              </Group>
              <Title order={1} className="landing-hero-title">
                {t('landing.tagline')}
              </Title>
              <Text c="dimmed" size="lg" maw={640}>
                {t('landing.intro')}
              </Text>
              <Group gap="sm">
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
            <Box className="landing-hero-mark" aria-hidden="true">
              <Image src="/favicon.svg" alt="" w="100%" h="100%" />
            </Box>
          </Box>

          <Box component="section" className="landing-editorial-section" aria-labelledby="landing-features">
            <Box className="landing-section-heading">
              <Text className="landing-section-index" aria-hidden="true">
                I
              </Text>
              <Title order={2} id="landing-features">
                {t('landing.featuresTitle')}
              </Title>
            </Box>
            <Box className="landing-feature-list">
              {FEATURES.map(({ key, icon: FeatureIcon, tour }, index) => (
                <Box key={key} className="landing-feature">
                  <Text className="landing-feature-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </Text>
                  <FeatureIcon
                    size={28}
                    weight="duotone"
                    color="var(--text-muted)"
                    aria-hidden="true"
                  />
                  <Stack gap={6}>
                    <Title order={3} fz="h4">
                      {t(`landing.features.${key}.title`)}
                    </Title>
                    <Text size="sm" c="dimmed">
                      {t(`landing.features.${key}.text`)}
                    </Text>
                    {tour && (
                      <Anchor href={`/demo?step=${tour}`} size="sm">
                        {t('landing.seeInDemo')}
                      </Anchor>
                    )}
                  </Stack>
                </Box>
              ))}
            </Box>
          </Box>

          <Box component="section" className="landing-steps" aria-labelledby="landing-steps">
            <Group justify="space-between" align="baseline">
              <Title order={2} id="landing-steps">
                {t('landing.stepsTitle')}
              </Title>
              <Text className="landing-section-index" aria-hidden="true">
                II
              </Text>
            </Group>
            <SimpleGrid
              component="ol"
              cols={{ base: 1, sm: 3 }}
              spacing={0}
              p={0}
              m={0}
              className="landing-step-list"
            >
              {STEPS.map((step, index) => (
                <Stack component="li" key={step} gap="sm" className="landing-step">
                  <Text className="landing-step-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </Text>
                  <Text>{t(`landing.steps.${step}`)}</Text>
                </Stack>
              ))}
            </SimpleGrid>
          </Box>

          {!signedIn && (
            <Box
              component="section"
              id={SIGN_IN_ANCHOR}
              className="landing-sign-in"
              aria-labelledby="landing-sign-in"
            >
              <Stack gap="xs">
                <Text className="landing-section-index" aria-hidden="true">
                  III
                </Text>
                <Title order={2} id="landing-sign-in">
                  {t('landing.signInTitle')}
                </Title>
                <Text c="dimmed">{t('auth.prompt')}</Text>
              </Stack>
              <SignInButtons />
            </Box>
          )}

          {/* The privacy notice is readable before signing in (spec 31_3). */}
          <Group component="footer" justify="space-between" className="landing-footer">
            <Text size="sm" c="dimmed">
              {t('app.name')}
            </Text>
            <Anchor component={Link} to="/privacy" size="sm" c="dimmed">
              {t('auth.privacy')}
            </Anchor>
          </Group>
        </Stack>
      </Container>
    </>
  );
}
