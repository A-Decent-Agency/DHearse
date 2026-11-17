# Clone and adapt DHearse

DHearse is a private audio rehearsal widget, not a public performance,
recording, booking, or payment system. It began as the rehearsal-room
implementation in [DecentBusking](https://github.com/TheJollyLaMa/DecentBusking).
The standalone package preserves the private-room boundary and extracts the
minimum browser and worker code needed to run it independently.

## 1. Clone and run

Use Node.js 22.12 or newer:

```sh
git clone https://github.com/A-Decent-Agency/DHearse.git
cd DHearse
npm ci
cp .env.example .env
npm start
```

The worker is disabled until explicitly configured. See the root README for
LiveKit, Pinata, CORS, storage-key, and HTTPS setup. Never put provider
credentials or the encryption key in browser code.

## 2. Integrate with a host app

Embed the page with [`mount()`](../js/widget.mjs), and supply the host app's
wallet address and message-signing callbacks. The wallet signature authorizes
only private-room consent. The iframe has a separate verified-origin message
bridge; it does not read the host page's private JavaScript objects.

The host must call `walletChanged()` after account changes and await
`unmount()` before removing the iframe. A shutdown timeout or warning must be
shown and handled; do not silently discard it.

## 3. Adapt permissions and identity

- Replace the owner/engineer host policy with the receiving app's
  `isEligibleHost(wallet)` check. Return `false` or an explicit error when
  eligibility cannot be verified.
- Choose a product name and storage namespace that are unique to your
  deployment. Do not change the namespace or encryption key after writing
  checkpoints without a recovery/migration plan.
- Configure exact widget-page origins at the worker. Do not use wildcard
  origins or grant browser access to provider credentials.
- Keep practice separate from official show, soundcheck, booking, payment,
  safety, and contract logic. Integrate those responsibilities in the host
  application and test them independently.

## 4. Validate before relying on it

Run `npm test`, then test microphone permission, stop/close behavior, real
audio delivery between separate devices and networks, and the host wallet
bridge in the receiving dapp. Have musicians and audio engineers validate the
setup instructions. Mocks do not establish browser permission, provider
availability, latency, or a tested second-host integration.

## 5. Replace the product identity

Update the page title, copy, colors, product name, worker namespace, deployment,
and supporter release configuration. Retain the Apache-2.0 license and NOTICE,
credit the DecentBusking source, and do not reuse its artwork or imply that
clones support the original project.

## Current release boundary

DHearse source is independently testable, but a passing mock suite does not
make it production-live. ENS, Base Supporter mint/listing, Voyager reward
inventory, deployment, and real-device acceptance require separate verified
evidence. The release workflows prepare evidence and a steward review; they do
not submit transactions.
