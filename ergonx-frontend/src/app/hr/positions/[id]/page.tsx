"use client";

import { useParams } from "next/navigation";
import { OrganizationResourceDetail } from "@/components/organization/OrganizationResource";

export default function PositionDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <OrganizationResourceDetail kind="positions" id={id} />;
}
