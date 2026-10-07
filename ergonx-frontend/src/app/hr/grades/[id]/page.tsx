"use client";

import { useParams } from "next/navigation";
import { OrganizationResourceDetail } from "@/components/organization/OrganizationResource";

export default function GradeDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <OrganizationResourceDetail kind="grades" id={id} />;
}
