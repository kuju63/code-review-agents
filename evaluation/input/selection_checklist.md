# PR Selection Checklist for Business/B2B2C

Use this checklist when collecting PR targets for Gold set.

## 1. Stack quota

- Rails: 30%
- Spring Boot: 30%
- Front-end (React/Vue/Svelte): 40%

## 2. Business risk themes

Prioritize PRs that touch at least one of:

- Authentication and authorization
- Tenant boundary and data access control
- Billing or payment related logic
- PII handling and masking
- Workflow state transitions and approvals
- Audit logs and traceability

## 3. Review signal quality

- Has review comments on code lines
- Not only style nits
- Includes actionable feedback

## 4. Exclude for early phase

- Massive dependency bump PRs only
- Auto-format only PRs
- Generated files only
