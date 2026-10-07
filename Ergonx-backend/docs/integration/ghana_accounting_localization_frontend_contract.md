# Ghana Accounting Localization Frontend Contract

Tax profiles are maintained through the institution accounting configuration and vendor/customer records. They support tax suggestions and reporting context; they do not replace accountant review or GRA validation.

VAT withholding certificates are available at `/api/v1/vat-withholding-certificates/`. Issuance requires `vat_withholding_certificate.issue`, a posted vendor bill, an active-preset VAT withholding rule, and an institution configured as a VAT withholding agent. Issued certificates can be voided but are retained with audit history.

Ghana compliance reminders are available at `/api/v1/ghana-compliance-reminders/`. They track an authority, statutory reference, due date, status, and completion evidence. They are reminders only: the application does not file returns, remit funds, or determine legal compliance.
