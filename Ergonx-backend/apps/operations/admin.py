from django.contrib import admin

from apps.operations.models import BackgroundJob, ExportJob, ImportJob, ImportRowResult

admin.site.register([BackgroundJob, ImportJob, ImportRowResult, ExportJob])
