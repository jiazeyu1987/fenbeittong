# PRD: Fenbeitong to Kingdee Voucher Prototype

## Goal

Allow a student developer to independently build and verify the frontend and backend workflow for converting Fenbeitong reimbursement data into Kingdee voucher draft payloads.

## Users

- Teacher: reviews implementation and later integrates accepted work into `IntRuoyi`.
- Student: develops frontend and backend against mock contracts.

## In Scope

- Mock configuration template.
- Fixed JSON editing.
- Voucher preview.
- Local prepared record creation.
- Prepared record lookup.
- Contract and E2E verification.

## Out of Scope

- Real Fenbeitong access-token.
- Real Kingdee Save.
- Submit, Audit, posting, approval, or deletion.
- Full `IntRuoyi` permission, tenant, menu, and database implementation.

## Acceptance

- `npm run verify` passes.
- Page flow runs: fill mock template -> preview -> prepare -> query.
- Invalid source data fails with clear errors.
- No mock success hides validation failures.

