# Sandbox build results

Verified on 2026-11-05T21:19:32.066Z. The evidence checker accepted all three sandbox cases. Each has one completed capture and one merchant receipt. The failure case includes the real HTTP 422 ORDER_NOT_APPROVED response, a fresh APPROVED order lookup with no captures, and a separate recovery request with its own request ID.

The lost-response case has one capture request, an injected fault labelled separately, a successful reconciliation lookup and a current Gemini investigation with accepted evidence citations. The repeated-delivery case has one capture request and both local replay and ignored duplicate events.

The recording lasts 104.4 seconds. Buyer approvals preceded the recording. It shows live capture, reconciliation and recovery actions, and inspects the previously recorded rejection. The source includes the redacted evidence and exact captions.

Core-path suite: total 12, failed 0. A browser check confirmed the sandbox dropdown option and selected mode after opening an existing checkout. The missing option tag was corrected. Tests cover the capture safeguards, receipt deduplication, restart protection, model validation, redaction and HTTP boundary.

No production endpoint or paid service was used. The repository is MIT licensed.
