# Sandbox demonstration

The final recording shows the running local console and real PayPal sandbox responses. Buyer approval was completed before recording, using guest checkout and a generated sandbox card. The rejection segment inspects the recorded HTTP 422 response before completing explicit recovery on the same approved order. It is labelled as a replay of that recorded rejection. Transport response loss is injected. Duplicate delivery is a local replay, not a received PayPal webhook.

Duration: 104.4 seconds. Exact timed text is in [demo-captions.vtt](demo-captions.vtt).

- 0.0s: I built CaptureProof for merchants who need to know whether a failed checkout request left a successful payment behind.
- 7.0s: Real PayPal sandbox requests, test funds only. Buyer approval was completed before recording.
- 12.0s: The capture succeeds. Its response is deliberately withheld from checkout. This injected transport fault is labelled.
- 21.0s: Reconciliation reads the order again. Gemini explains the records and links its findings to the evidence.
- 29.0s: A matching completed capture means the payment must not be repeated. Inspect the linked response and request trace.
- 39.0s: One capture and one merchant receipt. Another capture is blocked by transaction-state checks.
- 44.0s: Replay of a recorded sandbox rejection: ORDER_NOT_APPROVED. A rejected request before approval, not a declined card.
- 56.0s: The same order has since been approved in sandbox. Approval alone has not captured it. Recovery needs a separate merchant action.
- 62.0s: Explicit recovery checks current approval, amount and absence of captures, then makes one capture request. One receipt is recorded.
- 76.1s: This captured transaction was delivered twice in a local replay. It is not a webhook received from PayPal. The duplicate was ignored.
- 87.1s: One capture and one receipt per checkout. The console runs locally with Node and SQLite, and exports redacted evidence.

The video file is attached to the build ticket. Public YouTube publication goes through Claire after Zara reviews it.
