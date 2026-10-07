import re

from django.db import models, transaction
from django.db.models.functions import Length
from django.utils import timezone


class AutoCodeMixin(models.Model):
    """Fills a blank tenant identifier (employee number, posting code, ...) on save.

    Codes look like ``EMP-000124`` or ``JOB-2026-00021``: the next number after the
    highest existing code with the same prefix in the institution. Generation runs
    under a lock on the institution row, so concurrent creates cannot collide, and
    a code supplied explicitly (imports, seeds) is kept as long as it is unique.
    """

    auto_code_field = "code"
    auto_code_prefix = ""
    auto_code_width = 4
    # Name of a date field whose year goes into the code, or "today"; None for no year.
    auto_code_year_from = None

    class Meta:
        abstract = True

    def auto_code_stem(self):
        if self.auto_code_year_from is None:
            return f"{self.auto_code_prefix}-"
        source = None if self.auto_code_year_from == "today" else getattr(self, self.auto_code_year_from, None)
        year = (source or timezone.localdate()).year
        return f"{self.auto_code_prefix}-{year}-"

    def next_auto_code(self):
        field = self.auto_code_field
        stem = self.auto_code_stem()
        last = (
            type(self)._base_manager.filter(
                institution_id=self.institution_id,
                **{f"{field}__regex": rf"^{re.escape(stem)}[0-9]+$"},
            )
            .annotate(_code_length=Length(field))
            .order_by("-_code_length", f"-{field}")
            .values_list(field, flat=True)
            .first()
        )
        number = int(last[len(stem):]) + 1 if last else 1
        return f"{stem}{number:0{self.auto_code_width}d}"

    def save(self, *args, **kwargs):
        field = self.auto_code_field
        if kwargs.get("raw", False) or (getattr(self, field) or "").strip():
            return super().save(*args, **kwargs)
        from apps.institutions.models import Institution

        with transaction.atomic():
            list(Institution.objects.select_for_update().filter(pk=self.institution_id).values_list("pk", flat=True))
            setattr(self, field, self.next_auto_code())
            return super().save(*args, **kwargs)
