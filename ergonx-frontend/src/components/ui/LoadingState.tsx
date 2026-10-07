import { DashboardSkeleton, DetailSkeleton, FormSkeleton, ListSkeleton, PageHeaderSkeleton, TableSkeleton } from "@/components/ui/Skeleton";
import SplashScreen from "@/components/brand/SplashScreen";

export type LoadingVariant = "page" | "dashboard" | "table" | "list" | "detail" | "form" | "inline" | "splash";

/**
 * Loading feedback. Defaults to a page-shaped skeleton so content-area
 * loaders do not flash a full-screen spinner inside the application shell.
 * `splash` is reserved for pre-session application start.
 */
export default function LoadingState({ variant = "page", label }: { variant?: LoadingVariant; label?: string }) {
  switch (variant) {
    case "splash":
      return <SplashScreen />;
    case "dashboard":
      return <DashboardSkeleton label={label} />;
    case "table":
      return <div className="space-y-6"><PageHeaderSkeleton /><TableSkeleton label={label} /></div>;
    case "list":
      return <ListSkeleton label={label} />;
    case "detail":
      return <DetailSkeleton label={label} />;
    case "form":
      return <div className="space-y-6"><PageHeaderSkeleton /><FormSkeleton label={label} /></div>;
    case "inline":
      return (
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-10 text-support text-ink-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-primary" aria-hidden="true" />
          {label ?? "Loading…"}
        </div>
      );
    default:
      return <DetailSkeleton label={label ?? "Loading page"} />;
  }
}
