# PostgreSQL backup and restore runbook

ErgonX does not claim high availability or zero data loss. Production PostgreSQL must use encrypted storage, TLS, least-privilege credentials, and a secrets manager supplied by the deployment environment.

## Backup policy

- Run an encrypted, compressed `pg_dump` at least daily; use a shorter interval when the institution's recovery-point objective requires it.
- Retain daily backups for 14 days and weekly backups for 12 weeks unless the operator's retention policy is stricter.
- Write backups to storage/volume independent of the primary PostgreSQL container. Never rely on files stored only inside the database container.
- Protect the encryption key separately from the backup artifact. Do not commit credentials, dumps, or keys to Git.

Example (PowerShell):

```powershell
$stamp = Get-Date -Format yyyyMMdd-HHmmss
pg_dump --format=custom --compress=9 --file="D:\ErgonXBackups\ergonx-$stamp.dump" "$env:ERGONX_DATABASE_URL"
```

Encrypt or upload the resulting artifact using the approved object-storage/KMS integration for the deployment. The command above intentionally leaves key management to that infrastructure.

## Restore

1. Provision a clean PostgreSQL 16 database with the least-privilege application owner.
2. Restore the custom-format dump into the selected database:

```powershell
pg_restore --clean --if-exists --no-owner --dbname="$env:ERGONX_RESTORE_DATABASE_URL" "D:\ErgonXBackups\ergonx-YYYYMMDD-HHMMSS.dump"
```

3. Apply migrations with `python manage.py migrate` and run `python manage.py check`.
4. Verify tenant counts, active memberships, module flags, audit history, and a representative login before redirecting traffic.

## Verification and recovery assumptions

- Perform a restore rehearsal at least monthly and record the restore duration and any migration drift.
- A backup is considered valid only after `pg_restore --list` succeeds and a clean restore passes the application checks.
- Recovery point is the last completed backup; recovery time depends on database size and infrastructure.
- Point-in-time recovery, cross-region replication, and automated failover are not included in this repository and must be supplied by deployment infrastructure if required.
