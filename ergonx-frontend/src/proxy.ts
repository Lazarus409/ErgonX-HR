import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * ErgonX HR edition: Payroll and Accounting pages are not part of the product
 * (see src/lib/product.ts), so their URLs answer with the standard 404 page.
 */
export function proxy(request: NextRequest) {
  return NextResponse.rewrite(new URL("/_not-in-ergonx-hr", request.url));
}

// Keep in sync with EXCLUDED_ROUTE_PREFIXES in src/lib/product.ts.
export const config = {
  matcher: ["/payroll/:path*", "/accounting/:path*", "/me/payslips/:path*", "/me/expenses/:path*"],
};
