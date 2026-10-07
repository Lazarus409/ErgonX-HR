import AuthenticationGate from "@/components/guards/AuthenticationGate";
import OnboardingFrame from "@/components/onboarding/OnboardingFrame";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <AuthenticationGate><OnboardingFrame>{children}</OnboardingFrame></AuthenticationGate>;
}
