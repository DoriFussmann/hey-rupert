import assert from "node:assert/strict";
import { test } from "node:test";
import { activeNavGroup, adminNavGroups, navItemActive } from "./nav.ts";

const group = (id: string) => adminNavGroups.find((item) => item.id === id)!;
const item = (id: string, label: string) => group(id).items.find((entry) => entry.label === label)!;

test("the admin nav has five groups and keeps every page it had", () => {
  assert.deepEqual(
    adminNavGroups.map((g) => g.label),
    ["Clients", "Matching", "Emails", "Agents", "Admin"],
  );
  const paths = new Set(adminNavGroups.flatMap((g) => g.items.map((i) => i.href)));
  for (const href of [
    "/admin",
    "/admin/nudge",
    "/admin/timeline",
    "/admin/fund-database",
    "/admin/taxonomy",
    "/admin/matching",
    "/admin/notifications",
    "/admin/forms/statement-of-work",
    "/admin/forms/service-order",
    "/admin/forms/nda",
    "/admin/forms/emails",
    "/admin/forms/intake",
    "/admin/forms/materials",
    "/admin/forms/agents",
    "/admin/forms/outreach-styles",
  ]) {
    assert.ok(paths.has(href), href);
  }
});

test("the current page opens its group and highlights its link", () => {
  assert.equal(activeNavGroup("/admin"), "clients");
  assert.equal(activeNavGroup("/admin/clients/abc/setup"), "clients");
  assert.equal(activeNavGroup("/admin/matching"), "matching");
  assert.equal(activeNavGroup("/admin/forms/nda"), "admin");
  assert.equal(activeNavGroup("/admin/forms/emails"), "emails");
  assert.equal(activeNavGroup("/admin/nudge"), "emails");
  assert.equal(activeNavGroup("/admin/forms/agents"), "agents");
  assert.equal(activeNavGroup("/admin/forms/agents/feedback_email"), "agents");
  assert.equal(activeNavGroup("/nowhere"), null);
  assert.ok(navItemActive("/admin/clients/x", "", item("clients", "Clients"), group("clients")));
  assert.ok(!navItemActive("/admin/timeline", "", item("clients", "Clients"), group("clients")));
});

test("section links: the one in the hash is current, the first one when there is no hash", () => {
  const emails = group("emails");
  const client = item("emails", "Client emails");
  const reminders = item("emails", "Reminders");
  assert.ok(navItemActive("/admin/forms/emails", "", client, emails));
  assert.ok(!navItemActive("/admin/forms/emails", "", reminders, emails));
  assert.ok(navItemActive("/admin/forms/emails", "emails-reminder", reminders, emails));
  assert.ok(!navItemActive("/admin/forms/emails", "emails-reminder", client, emails));
  assert.ok(!navItemActive("/admin/nudge", "", client, emails));
});

test("Agents: one link per managed prompt; All prompts is current only on the list itself", () => {
  const agents = group("agents");
  const all = item("agents", "All prompts");
  const narrative = item("agents", "Narrative email");
  assert.equal(narrative.href, "/admin/forms/agents/narrative_email");
  assert.equal(agents.items.length, 5 + 30);
  assert.ok(navItemActive("/admin/forms/agents", "", all, agents));
  assert.ok(!navItemActive("/admin/forms/agents/narrative_email", "", all, agents));
  assert.ok(navItemActive("/admin/forms/agents/narrative_email", "", narrative, agents));
});
