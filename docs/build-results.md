# Build results

Recorded November 5, 2026, America/Chicago. This is a local build record. It does not establish that the PayPal sandbox integration has run.

| Check | Observed result | Record |
| --- | --- | --- |
| Core-path suite | Total 12, failed 0 | [Command output](test-results.txt) |
| Free model access | Gemini 3.5 Flash-Lite returned a successful generation using a free-tier project | Model evaluation and browser investigation |
| Known-case model evaluation | Captured, duplicate delivery, failed request, missing evidence and conflicting evidence each produced the expected state with accepted citations | [Responses and synthetic evidence](model-evaluation.json) |
| Browser path | Lost-response rehearsal, reconciliation, one receipt and a model investigation completed | [Desktop screenshot](rehearsal-desktop.png) |
| Mobile layout | Checked at 390 × 844 with no horizontal overflow | [Mobile screenshot](rehearsal-mobile.png) |
| Source privacy | Credential values absent from tracked source and evidence | Private environment file excluded from the checkout |
| PayPal access | Missing sandbox app credentials, developer login needs a password not saved in Chrome | No live response or successful sandbox recovery claimed |

The model evaluation exposed an early error: a fixture name led the model to infer a lost response even when the trace contained no such event. Fixture names were removed from the prompt, and fault claims now require matching cited events. The saved evaluation uses the corrected evidence input. Rejected or unavailable model answers remain subject to deterministic fallback.

The sandbox runs, genuine rejected-capture recovery, real response exports and final public video remain to complete. The intended demo script and submission draft are included for that work. The current build is not ready for entry submission.
