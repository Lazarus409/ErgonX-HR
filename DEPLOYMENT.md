# ErgonX HR production deployment

ErgonX HR is the HR-only edition of ErgonX: Core HR, Leave, Attendance,
Recruitment and Reports. Payroll and Accounting are switched off by
`ERGONX_EXCLUDED_MODULES=PAYROLL,ACCOUNTING`. It must never share a database,
Render service or secrets with the main ErgonX ERP.

## Render

This repository is a monorepo: the Django API and Next.js application are
separate Render web services. Do not deploy the repository root as a single
Docker service: there is intentionally no root `Dockerfile`.

The included [`render.yaml`](render.yaml) creates the `ergonx-hr-api` and `ergonx-hr-web`
services, the `ergonx-hr-postgres` database and the hourly approval-reminder job. In Render, choose **New +**
then **Blueprint**, select this repository and branch, and provide these values
when Render prompts for them:

- `DJANGO_ALLOWED_HOSTS`: the API hostname only, for example
  `ergonx-hr-api.onrender.com` (no `https://`).
- `CORS_ALLOWED_ORIGINS`: the frontend origin, for example
  `https://ergonx-hr-web.onrender.com`.
- `FRONTEND_PUBLIC_URL`: the same frontend origin.
- `NEXT_PUBLIC_API_BASE_URL`: the complete API URL, for example
  `https://ergonx-hr-api.onrender.com/api/v1`.

After deployment, update the three URL values if you attach custom domains and
redeploy both web services. Configure SMTP variables in the API service only;
keep `EMAIL_DELIVERY_ENABLED=false` until those values are ready.

The development Compose file and demo seed commands (including `seed_ergonx_hr_demo`) are not production deployment tools. Use `compose.production.yaml` together with a secret `.env.production` file.

## Before first deployment

1. Provision DNS and TLS for separate application and API origins, for example `https://app.example.com` and `https://api.example.com`.
2. Copy `.env.production.example` to `.env.production`, generate unique PostgreSQL and Django secret values, and set the real host and CORS origins. Do not reuse local development credentials.
3. Put a TLS-terminating reverse proxy in front of the two loopback-bound services. The API must be reachable at the exact `NEXT_PUBLIC_API_BASE_URL` built into the frontend image.
4. Back up PostgreSQL before every release and test restoration independently.

## Build and start

```powershell
docker compose --env-file .env.production -f compose.production.yaml up -d --build
docker compose --env-file .env.production -f compose.production.yaml ps
```

The backend runs migrations and collects static files before Gunicorn starts. Do not run any `seed_*_demo` command in this environment; each one refuses production settings.

## First institution and real users

1. Create the first Django superuser from the backend container:

```powershell
docker compose --env-file .env.production -f compose.production.yaml exec backend python manage.py createsuperuser
```

2. Sign in, create/configure the institution, enable only the required modules, configure the organization and module prerequisites, then validate `/onboarding`.
3. In **Settings → Users & Memberships**, invite each real user and assign the least-privilege tenant role. The backend returns an acceptance link when requested.
4. Send the acceptance link through your approved email channel. The recipient sets their own password at `/accept-invitation/{token}` and then signs in normally.
5. Confirm onboarding readiness from the server-provided bootstrap response. Never mark onboarding complete client-side.

## Release checks

- Verify `/api/v1/schema/` through the public API origin and the application login through the public application origin.
- Confirm `NEXT_PUBLIC_ENABLE_DEV_AUTH_BYPASS=false` in the built frontend environment.
- Confirm production logs contain no development seed execution and that no PostgreSQL or pgAdmin port is publicly exposed.
- Rotate application/database credentials on the organization’s security schedule.
## Email delivery

Institution Admin invitations and forgotten-password links can be delivered by
Gmail or Google Workspace SMTP. Enable two-step verification for the sender
mailbox, create a Google App Password, and add the SMTP values to the
uncommitted `.env.production` file. Set `EMAIL_DELIVERY_ENABLED=true`, then
restart the backend container. Never use the mailbox's normal password. If
delivery is disabled or fails, the Super Admin workspace clearly requires
manual secure-link sharing.
