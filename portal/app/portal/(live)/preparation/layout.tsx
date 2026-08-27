import { BackLink } from "@/components/back-link";

export default function SetupSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BackLink href="/portal/setup" label="Setup" />
      {children}
    </>
  );
}
