import { redirect } from "next/navigation";
import { getAuthContext, homePathForRole } from "@/lib/auth";

export default async function HomePage() {
  const { user, role } = await getAuthContext();

  if (!user) {
    redirect("/login");
  }

  redirect(homePathForRole(role));
}
