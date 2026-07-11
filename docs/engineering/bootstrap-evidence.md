# Bootstrap Evidence

## Goal and Scope

Create a standalone frontend/backend collaboration kit under `E:\ProjectPackage\fenbeitong\student-collaboration-kit` so the student can independently develop and verify the Fenbeitong-to-Kingdee voucher workflow without receiving the full `IntRuoyi` project.

## Stack

- Node.js native HTTP backend.
- Static HTML/CSS/JavaScript frontend.
- Node built-in test runner.
- No external npm dependencies.

Evidence source: user requested a collaboration project under `E:\ProjectPackage\fenbeitong`; local Node is available.

## Prerequisites

- Node.js 20 or newer.
- npm.

## Commands

```bash
npm install
npm run dev:backend
npm run dev:frontend
npm run test:backend
npm run test:frontend
npm run test:contract
npm run test:e2e
npm run lint
npm run format
npm run build
npm run verify
```

## RED Evidence

Before scaffold creation, `student-collaboration-kit` did not exist and no runnable collaboration package was available.

## GREEN Evidence

Run from `student-collaboration-kit`:

```bash
npm run verify
```

## Environment

`.env.example` exists. No real Fenbeitong token, Kingdee credential, database URL, or production secret is required.

## CI Status

No remote CI is configured yet. Local `npm run verify` is the current acceptance gate.

## Known Blockers

- Real Fenbeitong token is intentionally absent.
- Real Kingdee Save remains outside this student kit.
- Teacher must integrate accepted work into `IntRuoyi` later.

