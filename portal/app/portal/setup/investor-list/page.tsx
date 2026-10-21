import Link from "next/link";
import { ResponseHistory } from "@/components/setup/response-history";
import { InvestorListReview } from "@/app/portal/setup/investor-list/investor-list-review";
import { DEFAULT_SIGNATURE } from "@/lib/email-templates";
import { loadEmailSettings } from "@/lib/email-settings";
import { isServiceRoleConfigured } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { adminFirstName } from "@/lib/investor-list-email";
import { getPortalSetup } from "@/lib/portal-setup";
import { asInvestorList } from "@/lib/setup";
import { createServiceClient } from "@/lib/supabase/admin";

export default async function InvestorListPage() {
  const { client, row, viewAs } = await getPortalSetup("investor_list");
  const visible = Boolean(row && row.version > 0);
  const list = asInvestorList(row?.published);
  const settings =
    visible && isServiceRoleConfigured()
      ? await loadEmailSettings(createServiceClient())
      : null;
  const adminName = adminFirstName(settings?.signature || DEFAULT_SIGNATURE);
  const company = client?.company_name?.trim() || "Your company";
  const open = row?.status === "with_client";

  return (
    <>
      <p className="mb-md">
        <Link
          href="/portal/setup"
          className="inline-flex min-h-[44px] items-center text-body text-primary underline"
        >
          Setup
        </Link>
      </p>
      {row?.status === "confirmed" ? (
        <p className="mb-lg text-body text-heading" role="status">
          You confirmed this list
          {row.response?.at ? ` on ${formatDate(row.response.at)}` : ""}.
        </p>
      ) : null}
      {row?.status === "changes_requested" ? (
        <p className="mb-lg text-body text-heading" role="status">
          Rupert has your note. He&apos;ll reply and send this list back for you to confirm.
        </p>
      ) : null}
      {visible && row ? (
        <InvestorListReview
          rows={list.rows}
          summary={list.summary}
          scheme={list.tier_scheme}
          verification={list.verification}
          flags={list.client_flags}
          version={row.version}
          open={open}
          company={company}
          adminName={adminName}
          publishedAt={row.published_at}
          adminNote={list.admin_note}
          readOnly={viewAs}
        />
      ) : (
        <header>
          <h1 className="text-h1 text-heading">Your investor list</h1>
          <p className="mt-sm text-body text-secondary">
            Rupert is preparing your investor list. You&apos;ll get an email when it is ready to
            review.
          </p>
        </header>
      )}
      {visible && row ? (
        <ResponseHistory history={row.history} currentVersion={row.version} />
      ) : null}
    </>
  );
}
