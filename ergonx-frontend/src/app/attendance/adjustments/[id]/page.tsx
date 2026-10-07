"use client";

import { useParams } from "next/navigation";

import AdjustmentReview from "@/components/attendance/AdjustmentReview";

export default function AttendanceAdjustmentReviewPage() {
  const params = useParams<{ id: string }>();
  return <AdjustmentReview id={params?.id ?? ""} backHref="/attendance/adjustments" backLabel="Back to adjustments" linkBase="/attendance/adjustments" />;
}
