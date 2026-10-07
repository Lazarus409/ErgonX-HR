import {
  OnboardingData,
  OnboardingStep,
} from "@/types/onboarding";

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "institution",
    title: "Institution",
    description: "Set up the basic institution information.",
    required: true,
  },
  {
    id: "modules",
    title: "Modules",
    description: "Choose the modules your institution will use.",
    required: true,
  },
  {
    id: "organisation",
    title: "Organisation Setup",
    description: "Configure your organisation details.",
    required: true,
  },
  {
    id: "hr",
    title: "HR Configuration",
    description: "Configure core HR settings.",
    required: true,
    module: "HR",
  },
  {
    id: "scheduling",
    title: "Scheduling",
    description: "Configure the standard working schedule.",
    required: true,
    module: "ATTENDANCE",
  },
  {
    id: "payroll",
    title: "Payroll Setup",
    description: "Configure payroll processing.",
    required: true,
    module: "PAYROLL",
  },
  {
    id: "accounting",
    title: "Accounting Setup",
    description: "Configure accounting and tax settings.",
    required: true,
    module: "ACCOUNTING",
  },
  {
    id: "payroll_gl",
    title: "Payroll-to-GL Mapping",
    description: "Map payroll accounts to the general ledger.",
    required: true,
    module: "PAYROLL",
  },
  {
    id: "users_roles",
    title: "Users & Roles",
    description: "Configure the initial administrator.",
    required: true,
  },
  {
    id: "validation",
    title: "Validation",
    description: "Check configuration and prepare the institution.",
    required: true,
  },
];

export const DEFAULT_ONBOARDING_DATA: OnboardingData = {
  institution: {
    name: "",
    code: "",
    country: "Ghana",
    timezone: "Africa/Accra",
    currency: "GHS",
  },

  enabledModules: [
    "HR",
    "LEAVE",
    "ATTENDANCE",
    "PAYROLL",
    "ACCOUNTING",
    "REPORTS",
  ],

  organisation: {
    organisationType: "",
    address: "",
    phone: "",
    email: "",
    website: "",
  },

  hr: {
    employeeNumberPrefix: "EMP",
    employmentTypes: [
      "Permanent",
      "Contract",
      "Intern",
    ],
    staffCategories: [
      "Management",
      "Senior Staff",
      "Junior Staff",
      "Other",
    ],
  },

  scheduling: {
    workWeek: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ],
    startTime: "08:00",
    endTime: "17:00",
    workingHours: "8",
  },

  payroll: {
    enabled: true,
    configurationMode: "",
  },

  accounting: {
    enabled: true,
    institutionType: "",
    configurationMode: "",
  },

  payrollGl: {
    mapped: false,
    payrollAccount: "",
    salaryExpenseAccount: "",
    taxPayableAccount: "",
  },

  usersRoles: {
    adminEmail: "",
    adminRole: "INSTITUTION_ADMIN",
    inviteUsers: false,
  },
};
