import { SignOutButton } from "@/components/sign-out-button";

export function AppShell({
  brand,
  eyebrow,
  navigation,
  children,
}: {
  brand: string;
  eyebrow: string;
  navigation: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-container lg:flex">
      <aside className="flex w-full flex-col border-b border-border bg-surface px-md py-lg lg:w-60 lg:border-b-0 lg:border-r lg:px-md">
        <p className="px-sm text-label uppercase tracking-label text-muted">
          {eyebrow}
        </p>
        <p className="mt-xs px-sm font-light text-h4 tracking-headline text-heading">
          {brand}
        </p>
        <div className="mt-xl flex-1">{navigation}</div>
        <div className="mt-lg px-sm">
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-md py-lg lg:px-xl lg:py-xl">
        <div className="mx-auto w-full max-w-container">{children}</div>
      </main>
    </div>
  );
}
