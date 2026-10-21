import { redirect } from "next/navigation";

/** The duplicate report moved to Taxonomy. */
export default function OldDuplicatesPage() {
  redirect("/admin/taxonomy/duplicates");
}
