import "server-only";
import { getPortalView } from "@/lib/data";
import {
  getSetupItems,
  type SetupItem,
  type SetupStepId,
  type SetupStepState,
} from "@/lib/setup";

/** The signed-in client's Setup state, for the portal Setup pages. */
export async function getPortalSetup(step?: SetupStepId) {
  const { client, viewAs } = await getPortalView();
  const items = getSetupItems(client);
  const item: SetupItem | null = step
    ? (items.find((entry) => entry.id === step) ?? null)
    : null;
  const row: SetupStepState | null = step
    ? (client?.setup_steps?.find((entry) => entry.step === step) ?? null)
    : null;
  return { client, viewAs, items, item, row };
}
