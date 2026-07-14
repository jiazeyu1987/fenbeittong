# Teacher Review Checklist

## Mock Teaching Acceptance

- [ ] Run `npm install`.
- [ ] Run `npm run verify` and keep the passing output.
- [ ] Start backend with `npm run dev:backend`.
- [ ] Start frontend with `npm run dev:frontend`.
- [ ] Open `http://127.0.0.1:5173`.
- [ ] Click or follow: load standard config, save config, sync Fenbeitong, select one source document, preview voucher, generate prepared voucher, Mock save ERP draft.
- [ ] Pass condition: the page shows mock mode, Mock replacement is visible, voucher debit equals credit, and the save message says this is not a real ERP write.
- [ ] Pass condition: process records show `ERP_PUSHED` and operation logs show sync, prepare and ERP push records.

## Joint Debug Acceptance

- [ ] Real Fenbeitong mode is not accepted until the selected company has SQLite tenant credentials and a confirmed token/list/detail pull.
- [ ] If real mode is configured without required values, readiness must show the missing field names.
- [ ] Error summary must show failure step, error code, reason and the next person-action.
- [ ] Technical details may contain JSON, but teachers should only need the summary and checklist to judge the result.

## Real ERP Acceptance Blockers

- [ ] Fenbeitong company credentials are stored in SQLite and confirmed usable.
- [ ] Kingdee test account has a proven `GL_VOUCHER` Save request/response with FID and Number.
- [ ] Finance confirms account, tax and detail-dimension mappings.
- [ ] A real saved voucher can be queried in Kingdee and remains draft only: not submitted, not audited and not posted.
