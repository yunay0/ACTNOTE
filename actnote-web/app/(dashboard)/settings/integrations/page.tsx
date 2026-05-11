import IntegrationsSettingsClient from "./integrations-client";

export default function IntegrationsPage({
  searchParams,
}: {
  searchParams: { error?: string; connected?: string; message?: string };
}) {
  return (
    <IntegrationsSettingsClient
      bannerError={searchParams.error}
      bannerMessage={searchParams.message}
      connected={searchParams.connected === "1"}
    />
  );
}
