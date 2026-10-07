/**
 * ErgonX HR edition. Payroll and Accounting are not part of this product: the
 * backend never enables them (ERGONX_EXCLUDED_MODULES) and does not mount their
 * API, so the UI treats them as permanently disabled and their routes as absent.
 */
export const PRODUCT_NAME = "ErgonX HR";

export const EXCLUDED_MODULES: ReadonlySet<string> = new Set(["PAYROLL", "ACCOUNTING"]);

/** Route trees that belong only to an excluded module. */
export const EXCLUDED_ROUTE_PREFIXES = ["/payroll", "/accounting", "/me/payslips", "/me/expenses"] as const;

export function isModuleOffered(code: string): boolean {
  return !EXCLUDED_MODULES.has(code.trim().toUpperCase());
}
