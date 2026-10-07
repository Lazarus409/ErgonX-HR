"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  useRef,
  useState,
  type DragEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertCircle, ChevronDown, UploadCloud } from "lucide-react";

import { cx } from "@/lib/cx";

/* -------------------------------------------------------------------------- */
/* Field: label + control + helper/error, wired for assistive technology       */
/* -------------------------------------------------------------------------- */

export interface FieldProps {
  label: ReactNode;
  /** Control element; receives id/aria wiring automatically. */
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }>;
  helper?: ReactNode;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  className?: string;
  /** Visually hide the label while keeping it accessible. */
  hideLabel?: boolean;
  id?: string;
}

export function Field({ label, children, helper, error, required, optional, className, hideLabel, id }: FieldProps) {
  const generated = useId();
  const controlId = id ?? children.props.id ?? generated;
  const helperId = helper ? `${controlId}-helper` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [children.props["aria-describedby"], helperId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={controlId} className={cx("text-support font-semibold text-ink-strong", hideLabel && "sr-only")}>
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
        {optional && <span className="ml-1.5 font-normal text-ink-subtle">(optional)</span>}
      </label>
      {isValidElement(children)
        ? cloneElement(children, { id: controlId, "aria-describedby": describedBy, "aria-invalid": error ? true : children.props["aria-invalid"], required: required ?? children.props.required })
        : children}
      {helper && !error && <p id={helperId} className="text-caption text-ink-muted">{helper}</p>}
      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-caption font-medium text-danger-ink">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

export type ControlSize = "sm" | "md" | "lg";

const controlBase =
  "w-full min-w-0 rounded-lg border border-line-strong bg-surface text-ink-strong transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-ink-subtle hover:border-ink-subtle/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15 read-only:bg-surface-muted";

const controlSizes: Record<ControlSize, string> = {
  sm: "h-8 px-2.5 text-support",
  md: "h-9 px-3 text-sm",
  lg: "h-12 px-4 text-[0.9375rem]",
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: ControlSize;
  leadingIcon?: ReactNode;
  trailingSlot?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ size = "md", leadingIcon, trailingSlot, className, ...rest }, ref) {
  if (!leadingIcon && !trailingSlot) {
    return <input ref={ref} data-ui="input" className={cx(controlBase, controlSizes[size], className)} {...rest} />;
  }
  return (
    <div className="relative flex w-full items-center">
      {leadingIcon && <span className={cx("pointer-events-none absolute flex text-ink-subtle", size === "lg" ? "left-4 [&_svg]:h-5 [&_svg]:w-5" : "left-3 [&_svg]:h-4 [&_svg]:w-4")} aria-hidden="true">{leadingIcon}</span>}
      <input ref={ref} data-ui="input" className={cx(controlBase, controlSizes[size], leadingIcon && (size === "lg" ? "pl-12" : "pl-9"), trailingSlot && (size === "lg" ? "pr-12" : "pr-10"), className)} {...rest} />
      {trailingSlot && <span className={cx("absolute flex items-center", size === "lg" ? "right-2.5" : "right-1.5")}>{trailingSlot}</span>}
    </div>
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  size?: ControlSize;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ size = "md", className, children, ...rest }, ref) {
  return (
    <div className="relative w-full">
      <select ref={ref} data-ui="select" className={cx(controlBase, controlSizes[size], "appearance-none pr-9", className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} data-ui="textarea" className={cx(controlBase, "min-h-24 px-3 py-2.5 text-sm leading-6", className)} {...rest} />;
});

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, ChoiceProps>(function Checkbox({ label, description, className, id, ...rest }, ref) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <label htmlFor={controlId} className={cx("group flex min-h-6 items-start gap-3 text-sm text-ink", rest.disabled && "opacity-60", className)}>
      <input ref={ref} id={controlId} type="checkbox" data-ui="checkbox" className="mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0 rounded-md border-line-strong accent-[var(--primary)]" {...rest} />
      <span className="min-w-0">
        <span className="block font-medium text-ink-strong">{label}</span>
        {description && <span className="mt-0.5 block text-support text-ink-muted">{description}</span>}
      </span>
    </label>
  );
});

export const Radio = forwardRef<HTMLInputElement, ChoiceProps>(function Radio({ label, description, className, id, ...rest }, ref) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <label htmlFor={controlId} className={cx("flex min-h-6 items-start gap-3 text-sm text-ink", rest.disabled && "opacity-60", className)}>
      <input ref={ref} id={controlId} type="radio" data-ui="radio" className="mt-0.5 h-[1.125rem] w-[1.125rem] shrink-0 accent-[var(--primary)]" {...rest} />
      <span className="min-w-0">
        <span className="block font-medium text-ink-strong">{label}</span>
        {description && <span className="mt-0.5 block text-support text-ink-muted">{description}</span>}
      </span>
    </label>
  );
});

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({ checked, onChange, label, description, disabled, id, className }: SwitchProps) {
  const generated = useId();
  const controlId = id ?? generated;
  return (
    <div className={cx("flex items-start justify-between gap-4", disabled && "opacity-60", className)}>
      <label htmlFor={controlId} className="min-w-0 text-sm">
        <span className="block font-medium text-ink-strong">{label}</span>
        {description && <span className="mt-0.5 block text-support text-ink-muted">{description}</span>}
      </label>
      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 ease-standard", checked ? "bg-primary" : "bg-line-strong")}
      >
        <span className={cx("inline-block h-5 w-5 rounded-full bg-surface shadow-elevation-1 transition-transform duration-200 ease-standard", checked ? "translate-x-[1.375rem]" : "translate-x-0.5")} />
      </button>
    </div>
  );
}

export interface FileInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  hint?: ReactNode;
  fileName?: string | null;
}

/**
 * A calm, accessible drop zone over a native file input. Click or keyboard
 * opens the picker; dropping files fills the same input and fires its normal
 * change event, so callers keep one onChange path and their own validation.
 */
export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(function FileInput({ hint, fileName, className, id, ...rest }, ref) {
  const generated = useId();
  const controlId = id ?? generated;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const onDragOver = (event: DragEvent<HTMLLabelElement>) => {
    if (rest.disabled || !event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    setDragging(false);
    const input = inputRef.current;
    if (rest.disabled || !input || !event.dataTransfer.files.length) return;
    event.preventDefault();
    const transfer = new DataTransfer();
    const dropped = Array.from(event.dataTransfer.files);
    (rest.multiple ? dropped : dropped.slice(0, 1)).forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <label
      htmlFor={controlId}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cx(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors hover:border-primary hover:bg-primary-soft/50 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15",
        dragging ? "border-primary bg-primary-soft/70" : "border-line-strong bg-surface-muted/60",
        rest.disabled && "pointer-events-none opacity-60",
        className,
      )}
    >
      <UploadCloud className="h-6 w-6 text-primary" aria-hidden="true" />
      <span className="text-sm font-semibold text-ink-strong">{fileName || (dragging ? "Drop to upload" : "Choose a file or drag it here")}</span>
      {hint && <span className="text-caption text-ink-muted">{hint}</span>}
      <input ref={setRefs} id={controlId} type="file" data-ui="file" className="sr-only" {...rest} />
    </label>
  );
});

/** Groups related fields under a heading with calm spacing. */
export function FormSection({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  const headingId = useId();
  return (
    <section role="group" aria-labelledby={headingId} className={cx("grid gap-5 border-t border-line-soft pt-6 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,16rem)_1fr] lg:gap-10", className)}>
      <div>
        <h3 id={headingId} className="text-card-title font-bold text-ink-strong">{title}</h3>
        {description && <p className="mt-1 text-support text-ink-muted">{description}</p>}
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}
