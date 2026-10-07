/**
 * Display lifecycles for governed records, mirroring the backend state
 * machines documented in docs/phase2/wave0/lifecycle_matrix_final.md.
 * Keys are the backend status values; never rename them to match a design.
 */
export interface LifecycleStep {
  key: string;
  label: string;
  hint?: string;
  /** Reaching this step locks the record (immutable from here on). */
  final?: boolean;
}

export interface LifecycleOutcome {
  label: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
  /** Last main-path step the record had completed, if any. */
  afterStep?: string;
}

export interface Lifecycle {
  steps: LifecycleStep[];
  outcomes: Record<string, LifecycleOutcome>;
}

export const lifecycles: Record<string, Lifecycle> = {
  journal: {
    steps: [
      { key: "DRAFT", label: "Draft", hint: "Being prepared" },
      { key: "PENDING_APPROVAL", label: "Submitted", hint: "Awaiting approval" },
      { key: "APPROVED", label: "Approved", hint: "Ready to post" },
      { key: "POSTED", label: "Posted", hint: "Locked in the ledger", final: true },
    ],
    outcomes: {
      REVERSED: { label: "Reversed by a linked journal", tone: "warning", afterStep: "POSTED" },
      VOID: { label: "Voided before posting", tone: "neutral" },
    },
  },
  vendor_bill: {
    steps: [
      { key: "DRAFT", label: "Draft" },
      { key: "PENDING", label: "Submitted", hint: "Awaiting approval" },
      { key: "APPROVED", label: "Approved" },
      { key: "POSTED", label: "Posted", hint: "Locked in the ledger" },
      { key: "PART_PAID", label: "Part paid" },
      { key: "PAID", label: "Paid", final: true },
    ],
    outcomes: {
      REJECTED: { label: "Rejected; revise to resubmit", tone: "danger", afterStep: "DRAFT" },
      VOID: { label: "Voided before posting", tone: "neutral" },
    },
  },
  invoice: {
    steps: [
      { key: "DRAFT", label: "Draft" },
      { key: "ISSUED", label: "Issued", hint: "Locked; posted to the ledger" },
      { key: "PART_PAID", label: "Part paid" },
      { key: "PAID", label: "Paid", final: true },
    ],
    outcomes: {
      VOID: { label: "Voided before issue", tone: "neutral" },
    },
  },
  application: {
    steps: [
      { key: "DRAFT", label: "Draft" },
      { key: "ACTIVE", label: "In pipeline", hint: "Screening and interviews" },
      { key: "OFFERED", label: "Offered" },
      { key: "HIRED", label: "Hired", hint: "Employee record created", final: true },
    ],
    outcomes: {
      REJECTED: { label: "Not progressed", tone: "danger", afterStep: "ACTIVE" },
      WITHDRAWN: { label: "Withdrawn by the candidate", tone: "neutral", afterStep: "ACTIVE" },
    },
  },
};
