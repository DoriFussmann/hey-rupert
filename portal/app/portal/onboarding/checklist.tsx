import { Checklist } from "@/components/checklist";
import type { OnboardingItem } from "@/lib/onboarding";

export function OnboardingChecklist({ items }: { items: OnboardingItem[] }) {
  return (
    <Checklist
      items={items.map((item) => ({
        id: item.id,
        title: item.title,
        detail: item.detail,
        href: item.href,
        status: item.status,
        clickable: item.status === "your_turn" && Boolean(item.href),
        dimmed: item.status === "open",
      }))}
    />
  );
}
