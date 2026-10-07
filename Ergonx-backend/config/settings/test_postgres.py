import os

from .test import *  # noqa: F403


DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "ergonx_test"),
        "USER": os.environ.get("POSTGRES_USER", "ergonx"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "ergonx"),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 0,
    }
}
