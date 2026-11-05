# Recovery and investigation regressions

The latest capture attempt now takes precedence over an earlier rejection. If recovery completes remotely but its response is lost, the console shows **Unresolved** and asks for reconciliation. The sent marker still blocks another capture after restart. An inconclusive order lookup leaves the outcome unresolved. A matching completed capture resolves it and records one receipt.

The separate free-text model answer is omitted from both validated output and the console. This also covers answers saved by the earlier build. Findings retain their individual evidence links. A completed-payment claim needs a completed-capture response among that finding's citations, rather than an unrelated existing event. Capture instructions in model prose are rejected. The displayed next step comes from the current transaction state.

Run `npm test` with Node.js 24 or newer. The two tests in `test/review.test.mjs` cover recovery response loss, an inconclusive lookup, restart protection, reconciliation, the review's injected answer, contradictory findings, and an existing citation that does not support a paid conclusion.

The browser regression uses synthetic rehearsal data only. It does not create sandbox payment evidence.

| Checkpoint | Displayed outcome | Next step | Receipts | Capture requests |
| --- | --- | --- | --- | --- |
| Recovery response lost | Unresolved | Reconcile | 0 | 2, one rejected and one unanswered |
| After server restart | Unresolved | Reconcile | 0 | 2 |
| After read-only reconciliation | Captured | Do not repeat payment | 1 | 2 |

[Browser results](review-evidence/browser-results.json), [response-loss screenshot](review-evidence/recovery-response-lost.png), [restart screenshot](review-evidence/recovery-after-restart.png), [reconciled screenshot](review-evidence/recovery-after-reconcile.png), and [mobile screenshot](review-evidence/recovery-mobile.png) preserve the displayed state and advice. The browser check also confirmed HTTP 409 for repeat recovery, omission of a saved contradictory answer, working citation targets, no page exceptions and no horizontal overflow at 390 by 844.

[Fresh sandbox lookups](review-evidence/sandbox-recheck.json) reused the three existing sandbox orders and found the same completed captures with one receipt each. Repeat capture and recovery were blocked before calling the sandbox adapter. No capture request was sent by this check. [The updated sandbox investigation](review-evidence/sandbox-investigation.json) contains the current accepted model explanation and its matching response and injected-transport citations. Injected response loss remains labelled separately from PayPal responses.

[Five known-case model evaluations](model-evaluation.json) preserve actual model responses to synthetic evidence. The cases cover captured payment, duplicate delivery, rejection, missing evidence and conflicting records. Temporary service errors or rejected explanations fall back to the transaction checks. Prose validation remains conservative and cannot prove arbitrary natural language correct; payment actions are still controlled by transaction checks and an explicit merchant click.

The recorded sandbox demonstration and its timed captions are unchanged. These regressions cover the additional recovery response-loss case requested during review.
