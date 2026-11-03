// "Book a call" with Rupert, shown on every client portal page.
import { BOOK_CALL_URL } from "@/lib/book-call";

export { BOOK_CALL_URL };

function CalendarIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.75 3.25v2.5M14.25 3.25v2.5M3.5 8h13M4.75 4.75h10.5a1.25 1.25 0 0 1 1.25 1.25v9.25a1.25 1.25 0 0 1-1.25 1.25H4.75a1.25 1.25 0 0 1-1.25-1.25V6a1.25 1.25 0 0 1 1.25-1.25Z"
      />
    </svg>
  );
}

export function BookCallLink({ href = BOOK_CALL_URL, disabled = false }: { href?: string; disabled?: boolean }) {
  const body = (
    <>
      <span className="flex items-center gap-sm text-body-sm text-heading">
        <CalendarIcon />
        Book a call
      </span>
      <span className="mt-xs block text-body-sm text-muted">
        Questions or stuck? Grab 15 minutes with Rupert.
      </span>
    </>
  );

  const className =
    "mt-lg block rounded-md border border-border px-sm py-sm no-underline";

  if (disabled) {
    return (
      <span
        aria-disabled="true"
        title="Disabled while viewing as the client"
        className={`${className} opacity-50`}
      >
        {body}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${className} transition-colors duration-hover hover:border-primary/40 hover:bg-primary-tint`}
    >
      {body}
    </a>
  );
}
