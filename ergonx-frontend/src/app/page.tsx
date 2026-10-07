import AuthenticationGate from "@/components/guards/AuthenticationGate";
import WorkspaceHome from "@/components/home/WorkspaceHome";
import AppShell from "@/components/layout/AppShell";

/** The canonical authenticated Home: personal, permission-aware, and separate from Executive Dashboard. */
export default function HomePage() {
  return (
    <AuthenticationGate>
      <AppShell>
        <WorkspaceHome areaLabel="Home" showGreeting />
      </AppShell>
    </AuthenticationGate>
  );
}
