from django.core.exceptions import ValidationError


def calculate_localized_statutory(evaluator_code, **context):
    if evaluator_code == "GHANA_2026":
        from apps.payroll.localizations.ghana import calculate_statutory

        return calculate_statutory(**context)
    raise ValidationError(
        {"preset_version": f"Unknown payroll localization evaluator {evaluator_code}."}
    )
