# Nuvos — Access Control Policy

**Owner:** Diego Arria, Founder & CEO (security@nuvosai.com)
**Effective date:** September 29, 2026
**Review cadence:** every 6 months
**Related:** Nuvos Information Security Policy

## 1. Purpose and scope

This policy defines how access to Nuvos production assets and sensitive data is granted, used, reviewed and removed. It covers:

- **Production infrastructure and services:** application hosting, backend hosting, the production database, source-code hosting, payment processing, and data-aggregation providers (Plaid, Belvo). Nuvos operates no physical servers or data centers; all production assets are virtual and hosted by third-party cloud providers.
- **Sensitive data:** user profiles, portfolio holdings, chat history, and third-party access tokens.
- **Everyone** who is granted access to any of the above.

## 2. Principles

- **Least privilege.** Each person or service gets only the minimum access needed for its role.
- **Need to know.** Consumer financial data is accessed only to operate, support or secure the service.
- **Unique identities.** Every person uses their own named account. Shared credentials are not allowed.
- **Strong authentication.** Multi-factor authentication (MFA) is required on every production and administrative account.

## 3. Roles

| Role | Access |
|---|---|
| **Owner / Administrator** (Founder & CEO) | Administers production providers, approves and revokes access, manages secrets. |
| **Engineer** (if any) | Access to the systems their work requires, granted by the Owner. Production database access only when needed. |
| **Application user** (consumer) | Access only to their own data inside the Nuvos apps. |
| **Service accounts** | Backend-to-provider access through scoped API keys and OAuth tokens only. |

Admin features inside the Nuvos application are restricted to accounts explicitly flagged as administrators.

## 4. Access provisioning and removal

- Access is requested from and approved by the Owner, and is granted with the minimum role needed.
- When a person no longer needs access (role change or departure), it is removed from every provider the same day, and any credentials they could have seen are rotated.
- Third-party connections created by users (for example, a Plaid Item) are revoked at the provider when the user disconnects them, and the stored token is deleted.

## 5. Authentication

- **Workforce:** MFA is required on all production providers (hosting, database, source control, payments, data aggregation).
- **Consumers:** users sign in through our identity provider (Supabase Auth). Web sessions use secure, httpOnly cookies, and tokens are never stored in browser-accessible storage.
- **Services:** machine-to-machine authentication uses scoped API keys and OAuth access tokens over TLS. These are stored only as server-side environment variables, never in source code or client applications.

## 6. Application-level data access

- Every database table holding user data enforces row-level security, so a user can only read and write their own records. This was verified in September 2026: anonymous requests return no data from any table.
- The backend uses privileged database credentials only on the server, and only to perform actions on behalf of the authenticated user or for scheduled service jobs.
- Restricted data (access tokens, secrets) is never returned to clients and never written to logs.

## 7. Monitoring and reviews

- Provider audit logs (hosting, database, source control) are available and are reviewed when investigating anomalies.
- **Access reviews** happen at least every 6 months. The Owner confirms that every account with production access is still needed, has MFA enabled, and has the right role. The review is recorded below.
- **Secrets** are rotated immediately if a compromise is suspected, and when a person with access leaves.

## 8. Exceptions and enforcement

Exceptions require documented approval from the Owner and must be time-bound. Violations result in immediate removal of access.

## 9. Review log

| Date | Reviewer | Notes |
|---|---|---|
| 2026-09-29 | Diego Arria | Policy adopted; initial access review |
