# Reference-code contract

`ReferenceSequence` is a tenant-local server service, not a client counter. Supported namespaces include employee, recruitment, payroll, journal, AP/AR, cash, and expense records. Formats are generated from the configured prefix, reset policy, and padding; yearly and monthly sequences include the period in the output (for example `PR-2026-02-0001`).

Frontend clients must treat returned reference values as immutable display/search values. They must never derive an identifier using counts, cache a next number, or overwrite existing domain code fields. Historical domain identifiers remain supported while integrations are migrated incrementally.
