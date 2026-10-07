"use client";

import { useParams } from "next/navigation";
import { OrganizationResourceDetail } from "@/components/organization/OrganizationResource";

export default function DepartmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <OrganizationResourceDetail kind="departments" id={id} />;
}
