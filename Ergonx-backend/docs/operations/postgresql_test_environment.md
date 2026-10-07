# PostgreSQL 16 test environment

The application role must not receive broad production privileges merely to
run tests. Provision an isolated test database with an administrator account,
then run the suite with `--reuse-db`.

From `Ergonx-backend` (PowerShell):

```powershell
$env:POSTGRES_ADMIN_HOST = "localhost"
$env:POSTGRES_ADMIN_PORT = "5433"
$env:POSTGRES_ADMIN_DB = "postgres"
$env:POSTGRES_ADMIN_USER = "<postgres administrator>"
$env:POSTGRES_ADMIN_PASSWORD = "<administrator password>"
$env:POSTGRES_TEST_DB = "test_ergonx_system"
$env:POSTGRES_TEST_OWNER = "<application or dedicated test owner>"
& .\venv\Scripts\python.exe scripts\provision_test_database.py
```

Then configure the test connection and run:

```powershell
$env:DJANGO_SETTINGS_MODULE = "config.settings.test_postgres"
$env:POSTGRES_DB = "ergonx_system"
$env:POSTGRES_USER = "<test owner>"
$env:POSTGRES_PASSWORD = "<test owner password>"
$env:POSTGRES_HOST = "localhost"
$env:POSTGRES_PORT = "5433"
& .\venv\Scripts\python.exe -m pytest --reuse-db -q
```

The helper only creates `test_ergonx_system`; it does not drop databases,
modify the live application database, or store credentials. Do not point the
test settings at the production/demo database.

## Verified local Docker path

In the local Docker deployment used for this release candidate, the
administrator connection is available inside the PostgreSQL container while
the application role remains least-privileged. The isolated database was
created with:

```powershell
docker exec postgres16 psql -U postgres_admin -d postgres -c "CREATE DATABASE test_ergonx_system OWNER ergonx_app;"
```

After that one-time provisioning, the suite runs without granting
`CREATEDB` to `ergonx_app`:

```powershell
$env:DJANGO_SETTINGS_MODULE = "config.settings.test_postgres"
$env:POSTGRES_DB = "ergonx_system"
$env:POSTGRES_USER = "ergonx_app"
$env:POSTGRES_PASSWORD = "<application password>"
$env:POSTGRES_HOST = "localhost"
$env:POSTGRES_PORT = "5433"
& .\venv\Scripts\pytest.exe --reuse-db
```
