import { Container, Stack, Title, Text } from '@mantine/core';
import { GetServerSideProps } from 'next';
import { getProviders } from 'next-auth/react';
import React from 'react';

import { AccountsCard } from '~/components/Account/AccountsCard';
import { ApiKeysCard } from '~/components/Account/ApiKeysCard';
import { CreatorCard } from '~/components/Account/CreatorCard';
import { NotificationsCard } from '~/components/Account/NotificationsCard';
import { ProfileCard } from '~/components/Account/ProfileCard';
import { SettingsCard } from '~/components/Account/SettingsCard';
import { TagsCard } from '~/components/Account/TagsCard';
import { Meta } from '~/components/Meta/Meta';
import { env } from '~/env/server.mjs';
import { useFeatureFlags } from '~/providers/FeatureFlagsProvider';
import { getServerAuthSession } from '~/server/utils/get-server-auth-session';
import { getServerProxySSGHelpers } from '~/server/utils/getServerProxySSGHelpers';

export default function Account({ providers, isDev = false }: Props) {
  const { apiKeys } = useFeatureFlags();

  return (
    <>
      <Meta title="Manage your Account - Civitai" />

      <Container pb="md" size="xs">
        <Stack>
          <Stack spacing={0}>
            <Title order={1}>Manage Account</Title>
            <Text color="dimmed" size="sm">
              Take a moment to review your account information and preferences to personalize your
              experience on the site
            </Text>
          </Stack>
          <ProfileCard />
          <CreatorCard />
          <SettingsCard />
          <TagsCard />
          <NotificationsCard />
          <AccountsCard providers={providers} />
          {apiKeys && <ApiKeysCard />}
        </Stack>
      </Container>
    </>
  );
}

type Props = {
  providers: AsyncReturnType<typeof getProviders>;
  isDev: boolean;
};

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  const session = await getServerAuthSession(context);

  if (!session?.user)
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };

  const providers = await getProviders();
  const ssg = await getServerProxySSGHelpers(context);
  await ssg.account.getAll.prefetch();

  return {
    props: {
      trpcState: ssg.dehydrate(),
      providers,
      isDev: env.NODE_ENV === 'development', // TODO: Remove this once API Keys feature is complete
    },
  };
};
