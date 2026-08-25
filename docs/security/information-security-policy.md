# Information Security Policy

**Organization:** Appreciate Inc
**Effective date:** 2026-08-25
**Policy owner:** Nick (nick@appreciate.io)
**Review cadence:** Semi-annually (April, October)
**Version:** 1.0

---

## 1. Purpose

This policy defines the security controls Appreciate Inc applies to the data and systems that support our property-management operations. It exists to (a) protect resident, employee, and financial data from unauthorized access, disclosure, or loss; (b) meet the security expectations of the third-party services we integrate with (Mercury, Plaid, AppFolio, JustCall, and others); and (c) provide a documented baseline that is reviewed and improved on a recurring cadence.

## 2. Scope

This policy applies to:

- All software systems Appreciate Inc operates directly, including the KPI dashboard (Next.js on Vercel), the Supabase Postgres database, Supabase Edge Functions, and any first-party scrapers (e.g. `simmons-bot/capture.mjs`).
- All third-party services under our administrative control, including Mercury Bank, Plaid, AppFolio, JustCall, Rippling, Google Workspace, and GitHub.
- All employees, contractors, and agents who access resident, financial, or operational data.
- All devices used to access production systems (laptops, mobile devices).

## 3. Roles & responsibilities

| Role | Responsibility |
|---|---|
| Policy owner (Nick) | Approves the policy, chairs the semi-annual review, is the final decision-maker on security exceptions. |
| Engineering | Implements technical controls (access, encryption, logging), triages security-relevant incidents, keeps this document current with what the systems actually do. |
| All personnel | Follow the acceptable-use, credential, and incident-reporting requirements below. |

## 4. Data classification

Data handled by Appreciate Inc falls into three tiers:

1. **Restricted** — resident PII (SSN, DOB, government ID), payment credentials, bank account/routing numbers, Plaid access tokens, API keys, employee salary/payroll.
2. **Confidential** — resident contact info, lease terms, rent-roll amounts, financial statements, unit-level maintenance records, prospect applications.
3. **Internal** — general operational data (occupancy rates, portfolio KPIs) not intentionally published externally.

Restricted data must never leave systems where it originated (e.g. Plaid access tokens live only in Supabase; Mercury API keys live only in Supabase Edge Function secrets). Confidential data may move between our systems and the third-party services listed in §2. Internal data may be shared within the company freely.

## 5. Access control

- **Authentication.** Access to the KPI dashboard is gated by Google OAuth restricted to the `appreciate.io` domain. Non-`@appreciate.io` accounts are rejected before any application state loads. Supabase Postgres access is restricted to the service role (used only by trusted server-side code) and authenticated user role (subject to Row-Level Security).
- **Authorization.** Application-level authorization uses an `app_users` table with role assignments (`admin`, `user`). Admin-only pages call `requireAdmin()` in every route; user-only pages call `requireAuth()`. Row-Level Security policies on Supabase enforce that authenticated users only see rows they are entitled to.
- **Least privilege.** Access to Supabase, Vercel, GitHub, and third-party service consoles is granted per person on a need-to-know basis. Access is reviewed at each semi-annual policy review; leavers are removed within one business day of their last day.
- **Multi-factor authentication.** MFA is required on the Google Workspace account (which anchors all OAuth logins), on GitHub, on the Vercel account, on the Supabase account, and on Mercury. New third-party integrations must support MFA before onboarding.
- **Shared credentials are prohibited.** Every human accessing production systems does so under their own account. API tokens and service-role keys are treated as machine credentials and are never shared with humans outside engineering.

## 6. Cryptography and data protection

- **In transit.** All external traffic (browsers ↔ Vercel, server ↔ Supabase, server ↔ Plaid/Mercury/AppFolio/JustCall) uses TLS 1.2+.
- **At rest.** Supabase Postgres storage is encrypted at rest by the underlying platform (AES-256). Vercel deployment artifacts and environment variables are encrypted at rest by Vercel.
- **Secrets.** All secrets (API keys, database service-role keys, Plaid access tokens, third-party OAuth secrets) are stored either in Vercel environment variables, Supabase Edge Function secrets, or Supabase Vault. Secrets are **never** committed to Git; a pre-commit review confirms this for every change. Secrets are rotated when a person with access to them leaves.
- **Plaid access tokens** specifically are stored server-side in the `plaid_items.access_token` column and are never returned in any API response consumed by the browser. They are readable only via the Supabase service role, which is only used by trusted server code.

## 7. Software development lifecycle

- **Source control.** All code lives in a private GitHub repository (`nick-Appreciate/kpidashboard`). Changes land via git commits on `main`; Vercel deploys `main` automatically.
- **Code review.** For substantive changes, we require the author to describe intent, test evidence, and any security implications in the commit message. Reviewer sign-off from a second engineer is required for anything that touches auth, secrets, or externally-exposed API surfaces.
- **Dependency management.** JavaScript dependencies are managed via `package.json`; Dependabot / manual `npm audit` checks are run before merging any dependency bump. Suspicious or unmaintained dependencies are removed proactively.
- **Testing.** Automated typecheck and lint run on every deploy; behavioral verification is performed against the staging Vercel preview before merging changes that touch financial or resident data.
- **Change management.** Emergency changes may bypass staging when necessary (e.g. a security fix), but must be reviewed retroactively within 24 hours and documented in the commit history.

## 8. Vendor / third-party risk

Before granting a new third-party service access to Restricted or Confidential data we:

1. Confirm the vendor publishes a security posture statement (SOC 2, ISO 27001, or equivalent). Current vendors that meet this bar include: Mercury, Plaid, AppFolio, JustCall, Rippling, Vercel, Supabase, Google Workspace, GitHub.
2. Enable MFA on our vendor console account.
3. Store credentials/tokens in the systems described in §6 — never in personal password managers or shared documents.
4. Add the integration to §2 (Scope) of this policy at the next review cycle.

Vendor breaches or disclosed vulnerabilities affecting our data are treated as security incidents under §10.

## 9. Endpoint & workstation security

- Laptops used to access production systems have full-disk encryption enabled (FileVault on macOS).
- Devices are locked when unattended (screensaver password required).
- Operating systems and browsers are kept current with security updates.
- Personal devices used for company work must meet the same requirements.

## 10. Incident response

**Reportable events** include: suspected unauthorized access, credential compromise, malware infection on a device with production access, third-party vendor breach affecting our data, accidental disclosure of Restricted or Confidential data.

**Reporting.** Any person who suspects a security incident reports it immediately to the policy owner (Nick) via Slack DM or direct call.

**Response.** The policy owner (or delegate) will:

1. Contain — revoke credentials, disable accounts, or cut network access as appropriate within 1 hour of confirming an incident.
2. Assess — determine what data was accessed, whether it is likely to have been exfiltrated, and which residents/employees/third parties are affected.
3. Notify — inform affected parties (residents whose PII was accessed, third-party vendors whose accounts were involved) and any regulator whose reporting rules apply, within the timeframes those rules require.
4. Remediate — patch the root cause, rotate any exposed secrets, and update this document if the incident reveals a control gap.
5. Post-mortem — write a short (< 1 page) internal write-up covering root cause, timeline, and corrective actions, retained for at least three years.

## 11. Business continuity & backup

- Supabase provides point-in-time-recovery for the primary Postgres database at the platform tier we operate on. In addition, critical tables (`portfolio_snapshots`, `unit_acquisition_baselines`, `plaid_items`, `mercury_daily_balances`) can be re-populated from source systems (AppFolio, Mercury, Plaid) via the existing sync-* Edge Functions if the primary Postgres is destroyed.
- Vercel builds are reproducible from the GitHub `main` commit; an outage in one region can be recovered by redeploying from the same commit to a different region.
- The KPI dashboard is an operational tool, not a system of record. The system of record for financials is AppFolio; the system of record for cash is Mercury and (post-Plaid-link) the linked institution. Loss of the KPI dashboard degrades reporting temporarily but does not destroy business-critical data.

## 12. Personnel

- **Onboarding.** New employees or contractors are provisioned with Google Workspace (which anchors their access), only granted access to the systems they need for their role, and pointed at this policy on their first day. They acknowledge (verbally or in writing) that they will follow it.
- **Offboarding.** Departing personnel have Google Workspace, GitHub, Vercel, Supabase, Mercury, and any other production-adjacent access revoked within one business day of their last day. Shared machine credentials they had knowledge of are rotated.
- **Security awareness.** Anyone with production access receives an annual reminder of the phishing and social-engineering patterns most commonly targeting property-management companies (fake wire-transfer requests, spoofed vendor invoices, credential-stealing "urgent" emails).

## 13. Continuous improvement

- This policy is reviewed every six months (April and October) by the policy owner. Each review confirms that the actual system state matches what this document describes, updates the document to reflect any drift, and records lessons learned from incidents in the intervening period.
- Between reviews, this policy is updated within one week of any material change to authentication, data storage, or vendor list.
- All changes to this document are tracked in Git; the full history is available via `git log docs/security/information-security-policy.md`.

---

**Approval**

The policy owner (Nick, nick@appreciate.io) attests that the controls described above accurately reflect Appreciate Inc's current information security program, and takes responsibility for maintaining and improving them on the cadence described.

Approved: 2026-08-25
Appreciate Inc
