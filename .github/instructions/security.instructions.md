---
applyTo: "**/auth/**,**/*.env*,.github/workflows/**,packages/config/**,apps/api/**"
---

# Security

- Never commit or hardcode secrets. Use environment variables or managed secrets.
- Validate all external input. Enforce authorisation on every protected operation, server-side, with least privilege.
- Prevent cross-tenant access. Frontend filtering is never sufficient.
- GitHub integration requests minimum permissions. Repository access tokens are never exposed to the browser.
- Do not log source code or credentials.
- Changes to authentication, authorisation, secrets or tenant isolation need human approval and additional security review.
