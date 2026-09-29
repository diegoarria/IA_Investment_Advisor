# Nuvos — Information Security Policy

**Owner:** Diego Arria, Founder & CEO (security@nuvosai.com)
**Effective date:** September 29, 2026
**Review cadence:** every 6 months, and after any security incident or major architecture change.

## 1. Purpose and scope

This policy describes how Nuvos protects user data and its systems. It covers every production system: the web app (nuvosai.com), the mobile apps, the backend API, the database, and every third-party service that processes user data. It applies to everyone with access to those systems.

Nuvos is a read-only investment education and portfolio analysis product. It never holds or moves user money, never places trades, and never stores brokerage or bank passwords.

## 2. Roles and responsibilities

- The **Security Owner** (Founder & CEO) is accountable for this policy, approves access to production, reviews security risks, and leads incident response.
- Anyone who is granted production access must follow this policy and report suspected security issues to security@nuvosai.com immediately.

## 3. Data classification

| Class | Examples | Handling |
|---|---|---|
| **Restricted** | Third-party access tokens (Plaid, brokers, banks), API secrets, payment identifiers | Server-side only. Never sent to clients or logged. Encrypted at rest. |
| **Confidential** | User profile, portfolio holdings, chat history, financial data | Accessible only to the owning user (row-level security) and to backend services. |
| **Internal** | Aggregated, non-identifying product metrics | Limited to the team. |
| **Public** | Marketing site, public market data | No restrictions. |

## 4. Access control

- Access to production systems (hosting, database, payment, data-aggregation and source-code providers) is granted by least privilege and limited to people who need it for their role.
- Multi-factor authentication is required on every production and administrative account.
- Access is reviewed at least every 6 months, and removed immediately when no longer needed.
- Application users authenticate through our identity provider (Supabase Auth). Web sessions use secure, httpOnly cookies. Every database table holding user data enforces row-level security so each user can only access their own records.
- Administrative functions in the app are restricted to accounts explicitly flagged as admin.

## 5. Encryption

- All traffic between users, our apps, our API and our providers uses TLS (HTTPS). HSTS is enforced.
- Data at rest is encrypted by our database and hosting providers.
- Restricted secrets (API keys, credentials) are stored only as server-side environment variables, never in source code or client applications.

## 6. Secure development and change management

- All code lives in a private source-control repository. Changes are versioned and deployed through the hosting providers' deployment pipelines.
- An automated test suite runs before changes are shipped.
- Security-relevant changes are reviewed with attention to authorization, data exposure and injection risks.
- **Vulnerability scanning:** every production dependency set (backend Python, web and mobile JavaScript) is scanned automatically on every push to main and weekly (GitHub Actions `security-scan`: pip-audit and npm audit). Dependabot monitors all components for vulnerable and outdated packages and opens update PRs weekly.
- **Patching SLA** (from when a finding is identified):

  | Severity | Deadline |
  |---|---|
  | Critical | 7 days |
  | High | 30 days |
  | Medium | 90 days |
  | Low | Next routine update |

- **End-of-life software:** runtimes and frameworks (Python, Node.js, Next.js, Expo/React Native) are kept on supported versions. Any component announced as end-of-life is scheduled for upgrade before its end-of-support date. Dependabot and the semiannual policy review track this.
- Production servers are managed platforms (Railway, Vercel, Supabase); their operating system and runtime patching is handled by those providers.
- Production protections include API rate limiting, security headers (CSP, HSTS, anti-framing), and an emergency switch that disables AI features instantly.

## 7. Risk assessment and monitoring

- Security risks are identified and reviewed at least every 6 months, and whenever a new data source or third-party integration is added. Each review records the risks found, their mitigation and their owner.
- Periodic internal security reviews of the codebase are performed. The most recent one, in September 2026, hardened AI guardrails and access controls and fixed the issues found.
- Application and infrastructure logs are monitored for errors and anomalous activity. Logs must not contain Restricted data.

## 8. Vendor management

Third parties that process user data are chosen for their security posture and reviewed when onboarded and periodically afterwards. Current vendors include:

- hosting and database providers;
- payment processing (Stripe);
- data aggregation (Plaid, Belvo);
- AI model providers;
- email and notification providers.

Only the minimum data required is shared with each vendor.

## 9. Incident response

1. **Detect and report:** any suspected incident is reported to security@nuvosai.com.
2. **Contain:** revoke or rotate the affected credentials and tokens, disable the affected feature (including the AI kill switch if relevant), and block the abusive access.
3. **Investigate:** determine the scope, the affected data and the affected users.
4. **Notify:** affected users, and partners where required (including Plaid for incidents involving Plaid data), without undue delay and within any legally required timeframes.
5. **Recover and learn:** fix the root cause, document the incident, and update this policy if needed.

## 10. Data retention and deletion

- Users can delete their account and data from within the app, export their data, and disconnect any linked financial account at any time.
- Disconnecting an account revokes and deletes its stored access token.
- Data is kept only as long as needed to provide the service.

## 11. Policy review

The Security Owner reviews this policy at least every 6 months and records the review date below.

| Date | Reviewer | Notes |
|---|---|---|
| 2026-09-29 | Diego Arria | Initial version adopted |
