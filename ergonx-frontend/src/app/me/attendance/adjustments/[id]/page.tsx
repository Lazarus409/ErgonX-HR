"use client";

import { useParams } from "next/navigation";

import AdjustmentReview from "@/components/attendance/AdjustmentReview";

/** The requesting employee's view of their own attendance adjustment. */
export default function MyAttendanceAdjustmentPage() {
  const params = useParams<{ id: string }>();
  return <AdjustmentReview id={params?.id ?? ""} backHref="/me/attendance" backLabel="Back to my attendance" linkBase="/me/attendance/adjustments" />;
}
