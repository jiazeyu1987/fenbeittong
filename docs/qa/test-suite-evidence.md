# Test Suite Evidence

Automated coverage includes backend mapping/client/repository tests, frontend static tests, API contract tests, HTTP E2E, and Playwright toolbar E2E.

The contract tests assert that Save/View use `ER_ExpReimbursement`, transport subcategories map to `CI008`, and the payload contains no general-ledger voucher fields.

Run `npm run verify` for the current evidence set.
