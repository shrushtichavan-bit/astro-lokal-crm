import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ConfigPageClient } from "@/components/admin/config-client";

export default async function ConfigPage() {
  const user = await getSessionUser();
  if (user?.role !== "admin") redirect("/dashboard");
  return <ConfigPageClient />;
}
