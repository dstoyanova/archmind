# Security and Privacy

Security is a fundamental product requirement.

- Never commit secrets.
- Never hardcode credentials.
- Use environment variables and managed secrets.
- Validate all external input.
- Enforce authorisation on every protected operation.
- Apply least-privilege access.
- Protect against cross-tenant data access.
- Use secure authentication and session handling.
- Encrypt sensitive data.
- Avoid logging source code or credentials unnecessarily.

GitHub integration should use the minimum required permissions.

Repository access tokens must never be exposed to the browser.

Any change affecting authentication, authorisation, secrets or tenant isolation requires additional security review.
