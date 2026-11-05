# Recording script

Target length: 2 minutes 45 seconds. This is a recording plan, not a claim that the final demonstration exists. Complete the real sandbox runs before using it for the entry. Any rehearsal recording stays labelled as synthetic and is for build review only.

| Time | Screen action | Narration |
| --- | --- | --- |
| 0:00–0:15 | Show the console with PayPal sandbox selected and the lost-response fixture ready. | I built CaptureProof for the moment a checkout fails and the merchant needs to know whether the buyer already paid. |
| 0:15–0:35 | Create a sandbox order. Complete sandbox buyer approval, return and click capture. Keep the injected failure label visible. | This is a sandbox payment. The capture succeeds, then I deliberately withhold its response from the checkout. The timeout tells us the request failed to return. It does not tell us whether the payment failed. |
| 0:35–1:00 | Reconcile. Ask whether to repeat the payment. Keep the model source and linked findings in view. | CaptureProof reads the order again. There is a matching completed capture, so another capture is blocked. The investigation explains the failure from the transaction records and links its findings to the evidence. |
| 1:00–1:15 | Open the cited capture and order lookup. Show order ID, capture ID, status and matching amount. | These are the sandbox responses and the request trace. The injected transport fault is labelled separately. Reconciliation records one merchant receipt. |
| 1:15–1:40 | Start the failed-capture fixture. Try capture before approval and inspect the response. | Here the capture request is genuinely rejected by the sandbox because the buyer has not approved the order. This is a failed capture request, not a declined-card demonstration. There is no completed capture in these records. |
| 1:40–2:10 | Approve the same sandbox order, return and explicitly recover. Inspect the completed response. | Recovery is a separate action. The server reads the order again and checks approval, amount and the absence of captures before it sends anything. The investigation cannot make that decision or run the action. |
| 2:10–2:30 | Open the duplicate-delivery fixture after a successful sandbox capture. Replay the same delivery twice locally. | This delivery replay uses the captured transaction. It is labelled as a local replay, not a webhook received from PayPal. The duplicate creates no second capture and no second receipt. |
| 2:30–2:45 | Show the local setup command, test command and evidence export. | The console runs locally with Node and SQLite. Every finding has a trace or response behind it, and uncertain evidence stays unresolved. |

Keep the final video public on YouTube and the licensed source public only through the reviewed submission handoff. Do not expose the credential file, browser password fields or buyer details. Use the redacted response views. If any planned result differs from the observed sandbox run, correct the script before recording.
