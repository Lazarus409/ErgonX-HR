import { redirect } from "next/navigation";

export default function SelfServiceSecurityPage() {
  redirect("/settings/security");
}
