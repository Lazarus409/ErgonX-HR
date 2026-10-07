"""Provision the isolated PostgreSQL database used by the integration tests.

This script requires administrator credentials supplied through environment
variables. It never changes the application database and never prints a
password. Run it from the backend directory, then invoke pytest with
``--reuse-db`` and ``config.settings.test_postgres``.
"""

import os

import psycopg


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


admin_host = os.environ.get("POSTGRES_ADMIN_HOST", os.environ.get("POSTGRES_HOST", "localhost"))
admin_port = os.environ.get("POSTGRES_ADMIN_PORT", os.environ.get("POSTGRES_PORT", "5432"))
admin_db = os.environ.get("POSTGRES_ADMIN_DB", "postgres")
admin_user = required("POSTGRES_ADMIN_USER")
admin_password = required("POSTGRES_ADMIN_PASSWORD")
test_db = os.environ.get("POSTGRES_TEST_DB", "test_ergonx_system")
test_owner = os.environ.get("POSTGRES_TEST_OWNER", os.environ.get("POSTGRES_USER", admin_user))

connection = psycopg.connect(
    host=admin_host,
    port=admin_port,
    dbname=admin_db,
    user=admin_user,
    password=admin_password,
    autocommit=True,
)
try:
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (test_db,))
        if cursor.fetchone() is None:
            cursor.execute(f'CREATE DATABASE "{test_db.replace(chr(34), chr(34) * 2)}" OWNER "{test_owner.replace(chr(34), chr(34) * 2)}"')
            print(f"Created isolated test database: {test_db}")
        else:
            print(f"Isolated test database already exists: {test_db}")
finally:
    connection.close()
