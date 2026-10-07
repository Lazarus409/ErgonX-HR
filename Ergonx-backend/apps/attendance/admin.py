from django.contrib import admin

from apps.attendance.models import AttendanceAdjustment, AttendanceRecord, OvertimeRecord


admin.site.register([AttendanceRecord, AttendanceAdjustment, OvertimeRecord])
