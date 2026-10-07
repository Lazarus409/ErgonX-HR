from django.contrib import admin

from apps.institutions.models import (
    Institution,
    InstitutionMembership,
    InstitutionModule,
    InstitutionOnboarding,
    InstitutionFeatureOverride,
    InstitutionSetting,
    Permission,
    Role,
    SystemFeatureFlag,
)

admin.site.register(
    [
        Institution,
        Permission,
        Role,
        InstitutionMembership,
        InstitutionModule,
        InstitutionOnboarding,
        SystemFeatureFlag,
        InstitutionFeatureOverride,
        InstitutionSetting,
    ]
)
