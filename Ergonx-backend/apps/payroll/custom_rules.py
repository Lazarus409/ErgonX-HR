"""Institution-defined statutory rules for the CUSTOM payroll setup.

A custom configuration carries its own income tax and contribution rules in
``InstitutionPayrollConfiguration.custom_rules``. They are normalized here,
snapshotted onto each run when it is created, and evaluated from that snapshot,
so editing the configuration never changes a run already in progress.

Shape (amounts and rates are decimal strings; rates are percentages)::

    {
        "income_tax": {
            "method": "NONE" | "FLAT" | "PROGRESSIVE",
            "name": "Income tax",
            "basis": "TAXABLE_INCOME" | "GROSS_PAY" | "BASE_SALARY",
            "rate": "10",              # FLAT only
            "threshold": "0",          # tax-free amount taken off the basis
            "bands": [                 # PROGRESSIVE only, in order
                {"upper_bound": "490", "rate": "0"},
                {"upper_bound": null, "rate": "25"},   # last band is open
            ],
        },
        "contributions": [
            {"code": "PENSION", "name": "Pension", "basis": "BASE_SALARY",
             "employee_rate": "5.5", "employer_rate": "13", "maximum_basis": null},
        ],
    }
"""

from decimal import Decimal, InvalidOperation
import re

from django.core.exceptions import ValidationError

BASES = ("TAXABLE_INCOME", "GROSS_PAY", "BASE_SALARY")
TAX_METHODS = ("NONE", "FLAT", "PROGRESSIVE")
MAX_BANDS = 20
MAX_CONTRIBUTIONS = 10


def _decimal(value, label, *, allow_none=False, maximum=None):
    if value in (None, ""):
        if allow_none:
            return None
        raise ValidationError({"custom_rules": f"{label} is required."})
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValidationError({"custom_rules": f"{label} must be a number."})
    if not amount.is_finite() or amount < 0:
        raise ValidationError({"custom_rules": f"{label} cannot be negative."})
    if maximum is not None and amount > maximum:
        raise ValidationError({"custom_rules": f"{label} cannot exceed {maximum}."})
    return amount


def _basis(value, label):
    basis = str(value or "TAXABLE_INCOME").upper()
    if basis not in BASES:
        raise ValidationError({"custom_rules": f"{label} must be one of {', '.join(BASES)}."})
    return basis


def _text(value):
    return str(value) if value is not None else None


def normalize_custom_rules(raw):
    """Validate custom rules and return them in canonical, JSON-safe form."""
    if raw in (None, ""):
        raw = {}
    if not isinstance(raw, dict):
        raise ValidationError({"custom_rules": "Custom rules must be an object."})

    tax = raw.get("income_tax") or {}
    if not isinstance(tax, dict):
        raise ValidationError({"custom_rules": "Income tax must be an object."})
    method = str(tax.get("method") or "NONE").upper()
    if method not in TAX_METHODS:
        raise ValidationError({"custom_rules": f"Income tax method must be one of {', '.join(TAX_METHODS)}."})
    income_tax = {"method": method}
    if method != "NONE":
        income_tax.update(
            name=(str(tax.get("name") or "").strip() or "Income tax")[:100],
            basis=_basis(tax.get("basis"), "Income tax basis"),
            threshold=_text(_decimal(tax.get("threshold") or "0", "Tax-free threshold")),
        )
    if method == "FLAT":
        income_tax["rate"] = _text(_decimal(tax.get("rate"), "Income tax rate", maximum=Decimal("100")))
    if method == "PROGRESSIVE":
        bands = tax.get("bands") or []
        if not isinstance(bands, list) or not bands:
            raise ValidationError({"custom_rules": "Progressive tax needs at least one band."})
        if len(bands) > MAX_BANDS:
            raise ValidationError({"custom_rules": f"Use at most {MAX_BANDS} tax bands."})
        normalized, previous = [], Decimal("0")
        for index, band in enumerate(bands, start=1):
            if not isinstance(band, dict):
                raise ValidationError({"custom_rules": f"Tax band {index} must be an object."})
            last = index == len(bands)
            upper = _decimal(band.get("upper_bound"), f"Tax band {index} upper limit", allow_none=last)
            if upper is not None and upper <= previous:
                raise ValidationError({"custom_rules": f"Tax band {index} must end above the previous band."})
            rate = _decimal(band.get("rate"), f"Tax band {index} rate", maximum=Decimal("100"))
            normalized.append({"upper_bound": _text(upper), "rate": _text(rate)})
            previous = upper if upper is not None else previous
        income_tax["bands"] = normalized

    contributions_raw = raw.get("contributions") or []
    if not isinstance(contributions_raw, list):
        raise ValidationError({"custom_rules": "Contributions must be a list."})
    if len(contributions_raw) > MAX_CONTRIBUTIONS:
        raise ValidationError({"custom_rules": f"Use at most {MAX_CONTRIBUTIONS} contributions."})
    contributions, codes = [], set()
    for index, item in enumerate(contributions_raw, start=1):
        if not isinstance(item, dict):
            raise ValidationError({"custom_rules": f"Contribution {index} must be an object."})
        name = str(item.get("name") or "").strip()[:100]
        if not name:
            raise ValidationError({"custom_rules": f"Contribution {index} needs a name."})
        code = re.sub(r"[^A-Z0-9]+", "_", str(item.get("code") or name).upper()).strip("_")[:40] or f"CONTRIBUTION_{index}"
        if code in codes or code == "INCOME_TAX":
            raise ValidationError({"custom_rules": f"Contribution code {code} is used more than once."})
        codes.add(code)
        employee_rate = _decimal(item.get("employee_rate") or "0", f"{name} employee rate", maximum=Decimal("100"))
        employer_rate = _decimal(item.get("employer_rate") or "0", f"{name} employer rate", maximum=Decimal("100"))
        if not employee_rate and not employer_rate:
            raise ValidationError({"custom_rules": f"{name} needs an employee or employer rate."})
        contributions.append({
            "code": code,
            "name": name,
            "basis": _basis(item.get("basis") or "BASE_SALARY", f"{name} basis"),
            "employee_rate": _text(employee_rate),
            "employer_rate": _text(employer_rate),
            "maximum_basis": _text(_decimal(item.get("maximum_basis"), f"{name} maximum basis", allow_none=True)),
        })

    if method == "NONE" and not contributions:
        return {}
    return {"income_tax": income_tax, "contributions": contributions}


def normalize_pay_day_rule(raw):
    """``{}`` (not set), ``{"type": "LAST_DAY"}`` or ``{"type": "DAY_OF_MONTH", "day": 1-31}``."""
    if not raw:
        return {}
    if not isinstance(raw, dict):
        raise ValidationError({"pay_day_rule": "Pay day rule must be an object."})
    kind = str(raw.get("type") or "").upper()
    if kind == "LAST_DAY":
        return {"type": "LAST_DAY"}
    if kind == "DAY_OF_MONTH":
        try:
            day = int(raw.get("day"))
        except (TypeError, ValueError):
            day = 0
        if not 1 <= day <= 31:
            raise ValidationError({"pay_day_rule": "Pay day must be between 1 and 31."})
        return {"type": "DAY_OF_MONTH", "day": day}
    raise ValidationError({"pay_day_rule": "Pay day must be the last day or a day of the month."})


def progressive_tax(bands, amount):
    total, lower = Decimal("0"), Decimal("0")
    for band in bands:
        upper = Decimal(band["upper_bound"]) if band["upper_bound"] is not None else None
        top = amount if upper is None else min(amount, upper)
        if top > lower:
            total += (top - lower) * Decimal(band["rate"]) / Decimal("100")
        if upper is None or amount <= upper:
            break
        lower = upper
    return total
