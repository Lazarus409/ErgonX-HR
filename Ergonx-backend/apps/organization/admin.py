from django.contrib import admin

from apps.organization.models import Department, Grade, Location, Position

admin.site.register([Department, Position, Grade, Location])
