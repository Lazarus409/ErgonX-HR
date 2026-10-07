import { redirect } from "next/navigation";

/** Invitations live on the console home; keep old links working. */
export default function PlatformInvitationsRedirect() {
  redirect("/platform");
}
