"use client";

import {
  Check,
  Circle,
} from "lucide-react";

import {
  OnboardingStep,
  OnboardingStepId,
} from "@/types/onboarding";

interface OnboardingStepperProps {
  steps: OnboardingStep[];
  currentStep: number;
  completedSteps: OnboardingStepId[];
  onStepClick: (index: number) => void;
}

export default function OnboardingStepper({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
}: OnboardingStepperProps) {
  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const completed =
          completedSteps.includes(step.id);

        const active = index === currentStep;

        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onStepClick(index)}
            className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition ${
              active
                ? "bg-primary text-white"
                : "hover:bg-surface-hover"
            }`}
          >
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                active
                  ? "border-white bg-surface text-ink-strong"
                  : completed
                  ? "border-primary bg-primary text-white"
                  : "border-line-strong text-ink-subtle"
              }`}
            >
              {completed ? (
                <Check size={14} />
              ) : active ? (
                <Circle
                  size={10}
                  fill="currentColor"
                />
              ) : (
                <span className="text-xs">
                  {index + 1}
                </span>
              )}
            </div>

            <div className="min-w-0">
              <p
                className={`text-sm font-medium ${
                  active
                    ? "text-white"
                    : "text-ink"
                }`}
              >
                {step.title}
              </p>

              <p
                className={`mt-0.5 text-xs leading-5 ${
                  active
                    ? "text-ink-subtle"
                    : "text-ink-muted"
                }`}
              >
                {step.description}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
