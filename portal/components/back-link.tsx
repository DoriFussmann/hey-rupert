import Link from "next/link";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <p className="mb-md">
      <Link
        href={href}
        className="text-body-sm text-primary no-underline hover:text-primary-hover"
      >
        {label}
      </Link>
    </p>
  );
}
