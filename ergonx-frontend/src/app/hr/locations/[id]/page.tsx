"use client";

import { useParams } from "next/navigation";
import { OrganizationResourceDetail } from "@/components/organization/OrganizationResource";

export default function LocationDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <OrganizationResourceDetail kind="locations" id={id} />;
}
