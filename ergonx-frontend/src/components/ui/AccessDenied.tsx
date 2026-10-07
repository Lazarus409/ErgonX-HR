"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, Lock, UserPlus } from "lucide-react";

import { Button, ButtonLink } from "@/components/ui/Button";
import { TechnicalDetails } from "@/components/ui/StateBanner";
import { institutionsApi, getApiErrorMessage } from "@/lib/api";

/**
 * Permission-restricted state (concept "Governed empty, error and loading states").
 * "Request access" notifies the institution's user managers; it never grants anything by itself.
 */
export default function AccessDenied({
  title = "You don't have access",
  description = "You don't have permission to view this information. If you believe this is a mistake, contact an administrator.",
  area,
  permission,
  canRequest = true,
  preview = false,
  className,
}: { title?: string; description?: string; area?: string; permission?: string; canRequest?: boolean; /** Reference rendering: the request button is inert. */ preview?: boolean; className?: string }) {
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "repeat" | "error">("idle");
  const [problem, setProblem] = useState("");
  const subject = area ?? pathname ?? "this page";

  const request = async () => {
    setState("sending"); setProblem("");
    try {
      const result = await institutionsApi.requestAccess({ area: subject, permission, path: pathname ?? undefined });
      setState(result.already_requested ? "repeat" : "sent");
    } catch (caught) {
      setProblem(getApiErrorMessage(caught)); setState("error");
    }
  };

  return (
    <div className={className ?? "flex min-h-[420px] items-center justify-center rounded-3xl border border-line bg-surface p-6 shadow-elevation-1"}>
      <div className="flex max-w-md flex-col items-center text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-soft text-warning ring-8 ring-warning-soft/40" aria-hidden="true">
          <Lock className="h-8 w-8" />
        </span>
        <h2 className="mt-5 text-heading font-bold text-headline">{title}</h2>
        <p className="mt-2 text-support text-ink-muted">{description}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {canRequest && (state === "sent" || state === "repeat" ? (
            <p role="status" className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm font-semibold text-success-ink">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{state === "sent" ? "Request sent to your administrators" : "You already asked for this today"}
            </p>
          ) : (
            <Button variant="secondary" leadingIcon={<UserPlus className="h-4 w-4" />} loading={state === "sending"} disabled={preview} onClick={() => void request()}>Request access</Button>
          ))}
          {!preview && <ButtonLink href="/" variant="ghost">Return home</ButtonLink>}
        </div>
        {state === "error" && <p role="alert" className="mt-3 text-sm text-danger-ink">{problem}</p>}
        <TechnicalDetails>
          Page: {pathname ?? "unknown"}{permission ? <><br />Required permission: {permission}</> : null}
        </TechnicalDetails>
      </div>
    </div>
  );
}
