import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";

const steps = [
  {
    title: "Company profile",
    body: "Stage, sector, geography, check size, and what you will not take.",
    status: "acknowledged",
  },
  {
    title: "Universe build",
    body: "Funds, family offices, and angels filtered against that profile.",
    status: "acknowledged",
  },
  {
    title: "Fit pass",
    body: "Each name reviewed for thesis, recent activity, and conflict.",
    status: "pending",
  },
  {
    title: "Founder review",
    body: "You confirm the list before any sequence is queued.",
    status: "pending",
  },
];

export default function InvestorMatchingPage() {
  return (
    <>
      <PageHeader
        title="Investor Match"
        description="How the list is built for this raise, and where the work currently stands."
      />
      <ol className="grid gap-md">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className="rounded-card border border-border bg-surface px-lg py-lg"
          >
            <div className="flex flex-wrap items-start justify-between gap-md">
              <div>
                <p className="text-label uppercase tracking-label text-muted">
                  Step {index + 1}
                </p>
                <h2 className="mt-sm text-h4">{step.title}</h2>
                <p className="mt-sm max-w-prose text-body-sm text-muted">
                  {step.body}
                </p>
              </div>
              <StatusBadge status={step.status} />
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
