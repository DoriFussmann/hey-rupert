import { PageHeader } from "@/components/page-header";
import { getPortalView } from "@/lib/data";
import { isSetupOpen } from "@/lib/setup";

export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { client } = await getPortalView();
  if (!isSetupOpen(client?.stage)) {
    return (
      <PageHeader
        title="Setup"
        description="Opens once you submit your company materials."
      />
    );
  }
  return children;
}
