from django.contrib import admin

from apps.scheduling.models import (
    FlexibleWorkRule,
    RotationPattern,
    RotationStep,
    ScheduleAssignment,
    Shift,
    ShiftPattern,
    ShiftPatternDay,
    WorkSchedule,
)


admin.site.register(
    [
        Shift,
        ShiftPattern,
        ShiftPatternDay,
        RotationPattern,
        RotationStep,
        FlexibleWorkRule,
        WorkSchedule,
        ScheduleAssignment,
    ]
)
