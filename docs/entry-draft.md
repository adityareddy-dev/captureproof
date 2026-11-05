# Working submission draft

This draft is held for sandbox verification and the final recording. The repository remains private. The source and public video links must be finalised after review.

## Project name

CaptureProof

## Tagline

Know whether a failed checkout request left a successful payment behind.

## Inspiration

A checkout timeout leaves a merchant with a difficult question: did the buyer pay? Repeating the payment before checking its state can make a confusing incident worse. I wanted the transaction and its request trace in the same place, with an explanation that points to the records behind it.

## What it does

CaptureProof is a local merchant console for investigating one PayPal checkout. It joins order and capture responses to a request timeline. The investigation explains what the evidence supports and links each finding to the matching response or trace. Capture and recovery require an explicit merchant action and fresh transaction-state checks.

The local rehearsal covers a completed capture followed by an injected lost response, a duplicate webhook delivery replay, and a capture request rejected before buyer approval. Replayed and injected events are labelled separately. Missing or conflicting evidence stays unresolved.

## How it is built

Node.js serves the console and calls the PayPal sandbox Orders API. SQLite stores the checkout, traces, capture attempt markers and unique merchant receipts. Gemini explains redacted evidence in response to a merchant question. It has no payment tools. The server checks the returned state and citations before displaying an explanation.

## What is working

The three rehearsal paths, receipt deduplication, restart protection, evidence export and model-backed investigation are implemented. Known-case model runs use synthetic payment evidence. Real sandbox verification and the final video remain to add before submission.

## Testing instructions

Follow the README for a local rehearsal with Node.js 24 or newer. Sandbox and model setup instructions use credentials kept outside the repository. The test suite runs with `npm test`.
