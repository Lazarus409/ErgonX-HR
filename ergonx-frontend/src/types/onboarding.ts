export type OnboardingStepId =
  | "institution"
  | "modules"
  | "organisation"
  | "hr"
  | "scheduling"
  | "payroll"
  | "accounting"
  | "payroll_gl"
  | "users_roles"
  | "validation";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
  required: boolean;
  module?: string;
}

export interface OnboardingData {
  institution: {
    name: string;
    code: string;
    country: string;
    timezone: string;
    currency: string;
  };

  enabledModules: string[];

  organisation: {
    organisationType: string;
    address: string;
    phone: string;
    email: string;
    website: string;
  };

  hr: {
    employeeNumberPrefix: string;
    employmentTypes: string[];
    staffCategories: string[];
  };

  scheduling: {
    workWeek: string[];
    startTime: string;
    endTime: string;
    workingHours: string;
  };

  payroll: {
    enabled: boolean;
    configurationMode: "ghana_preset" | "manual" | "";
  };

  accounting: {
    enabled: boolean;
    institutionType: string;
    configurationMode: "ghana_preset" | "manual" | "";
  };

  payrollGl: {
    mapped: boolean;
    payrollAccount: string;
    salaryExpenseAccount: string;
    taxPayableAccount: string;
  };

  usersRoles: {
    adminEmail: string;
    adminRole: string;
    inviteUsers: boolean;
  };
}

export interface OnboardingState {
  currentStep: number;
  completedSteps: OnboardingStepId[];
  data: OnboardingData;
}
