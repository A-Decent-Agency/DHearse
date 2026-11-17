# DHearse

DHearse is a private, audio-only rehearsal room that can be run on its own or
embedded in another dapp. It is designed to be cloned and adapted: the room
service, eligibility policy, visual theme, wallet bridge, storage namespace,
and deployment are configurable without importing the rest of DecentBusking.

The original implementation came from DecentBusking's private rehearsal room
([`rehearsal.js`](https://github.com/TheJollyLaMa/DecentBusking/blob/main/discord-bot/rehearsal.js),
[`rehearsal.html`](https://github.com/TheJollyLaMa/DecentBusking/blob/main/rehearsal.html)).
This standalone extraction keeps private practice separate from any host app's
public broadcast, bookings, soundcheck, payment, eligibility, or contract
flows. Private room activity never creates performance credit.

## What it includes

- Private, invite-link audio rooms for up to six participants, with host and
  engineer controls, four-hour maximum lifetime, and automatic idle cleanup.
- Explicit wallet-signed consent; the signature grants no transaction,
  booking, recording, or public broadcast permission.
- Opt-in microphone publishing and listening, delivery checks, device
  selection, headphone guidance, and a practice-only browser monitor.
- A host-application wallet message bridge and an iframe `mount()`/`unmount()`
  API with customizable theme and sizing.
- A Node.js HTTP service that serves the widget, restricts rehearsal API
  origins, hosts LiveKit room tokens, and encrypts the small room checkpoint
  before storing it through Pinata.

The application does not implement recording, video, bookings, or on-chain
operations. Do not treat the private practice room as a production soundcheck
or a permission to go on air.

## Run locally

Requirements: Node.js 22.12 or newer, a LiveKit Cloud project, and a Pinata
JWT. The server binds to localhost and leaves rehearsal hosting disabled until
explicitly configured.

```sh
npm ci
cp .env.example .env
npm start
```

With the default configuration, the page loads and reports that private
rehearsal hosting is not enabled. To enable it, edit `.env`:

- Set `DHEARSE_ENABLED=true`.
- Set the worker owner wallet and optional engineer wallets.
- Set a new dedicated 32-byte hexadecimal `DHEARSE_STORAGE_KEY` (for example,
  generate one with `openssl rand -hex 32`). Never reuse a key from another
  application or commit the value.
- Set `PINATA_JWT` and the LiveKit URL, API key, and API secret.
- Set `DHEARSE_ALLOWED_ORIGINS` to the exact origin(s) where the widget page
  will be served, such as `https://dhearse.example`. For local development,
  retain `http://localhost:8080`.
- Set `DHEARSE_HOST` to `0.0.0.0` only when the deployment platform requires
  an externally reachable container. Terminate HTTPS at the hosting platform
  or a trusted reverse proxy.

Keep `DHEARSE_NAMESPACE` stable after the first checkpoint: it identifies the
encrypted checkpoint and is part of the encryption associated data. A new
namespace cannot decrypt old checkpoints. Keep the storage key private and
back it up securely; a lost key makes stored checkpoints unreadable.

By default, only the configured owner and engineers can start a room. To adapt
eligibility to a host app's invitation or booking rules, provide the service's
`isEligibleHost(wallet)` callback in `server/index.js` when calling
`createDhearseRuntime()`. The callback must return a boolean and should fail
closed when the host app cannot verify eligibility. Guests with a room link
can join without a booking.

## Embed the widget

Import [`mount()`](./js/widget.mjs) into the host app and provide its wallet
adapter. `signMessage` must sign the exact message supplied by DHearse; never
modify, persist, or broadcast it. The iframe origin is checked before any
wallet request or response is accepted.

```js
import { mount } from './dhearse/js/widget.mjs';

const rehearsal = await mount(document.querySelector('#rehearsal'), {
  src: 'https://dhearse.example/index.html',
  height: '760px',
  theme: {
    accent: '#e5c76d',
    background: '#171021',
    panel: '#24162d',
    text: '#f0e6c8',
  },
  getWalletAddress: async () => connectedWallet.address,
  signMessage: (message, address) => walletClient.signMessage({ account: address, message }),
  onRoom: roomId => console.info('Private rehearsal ready', roomId),
});

await rehearsal.ready;
// Call when the host app changes the connected wallet.
rehearsal.walletChanged();
// Await shutdown before removing the embedding container.
const result = await rehearsal.unmount();
if (result.warning) console.warn(result.warning);
```

`signMessage` above is pseudocode; adapt it to the host app's wallet SDK. The
host must sign only after the user initiates entry and approves the wallet
prompt. The server verifies the recovered address against the address supplied
by the host. A declined prompt or wallet mismatch stops entry.

Set the `DHEARSE_ALLOWED_ORIGINS` server value to the origin that serves the
widget itself (the iframe's origin), not merely its parent dapp. When the API
is hosted on a different origin, edit `dhearse.config.js` so `serviceUrl`
points to that HTTPS API and configure its exact CORS origin. Both the widget
and service must use HTTPS in production.

The standalone Node server serves the page and API on the same origin. Static
hosting by itself is not a backend: it must be paired with a deployed DHearse
service and a `serviceUrl` configuration.

## Customize

- **Visual identity:** edit `dhearse.config.js` and the CSS variables in
  [`live-audio.css`](./css/live-audio.css); `mount()` can override the six
  supported color tokens per instance.
- **Product and room identity:** set `DHEARSE_PRODUCT_NAME` and
  `DHEARSE_NAMESPACE`. Namespace values are lowercase letters, digits, and
  hyphens; keep one stable for each persistent deployment.
- **Host permissions:** supply `isEligibleHost(wallet)` for the embedding
  application's own rules. Never couple a private practice grant to a public
  broadcast grant.
- **UI and sound-check workflow:** adapt [`index.html`](./index.html) and the
  modules under [`js/`](./js/) to the host app's language, context, and
  accessibility needs.
- **Audio provider and persistence:** adapt [`server/index.js`](./server/index.js)
  and the transport/store adapters if your deployment uses different services.
  Keep the private storage encryption key and namespace unique and stable.

Do not expose LiveKit API secrets, the Pinata JWT, or the storage key to
browser code. The Node service returns short-lived, room-scoped LiveKit grants;
the browser never receives provider credentials.

## Validate

```sh
npm test
```

The automated tests cover wallet eligibility, signed consent, room isolation,
checkpoint failure handling, transport grants, CORS, the standalone server,
and the iframe wallet bridge. They do not prove successful microphone
permissions, two-device audio delivery, real network behavior, or usability
with musicians. Perform those checks with a real deployed worker, multiple
devices, and consenting musicians before depending on DHearse in a live
production workflow.

## Supporter release

The release workflows follow the DecentHead Supporter DNFT kit pinned to
commit `8523309e99126f5df84400317e6401c583525124`. A published GitHub release
prepares immutable release evidence and opens a steward review issue; it does
not submit a mint transaction. Standard terms are 1,000 editions, 10 USDC, and
10% royalty. Configure `SUPPORTER_ENS_NAME=DHearse.DecentAgency.eth` only
after the ENS subname and the deployed release site are verified. No mint,
ENS change, listing, announcement, or transfer is performed by this repository
setup.

### First version mint

The initial `v0.1.0` Supporter can present the working prototype; real-device
audio and second-host acceptance are separate product gates and are not implied
by the mint. Keep the release description clear that this is a prototype.

This follows the existing DecentMarket Supporter Studio flow and does **not**
use a private-key `.env`:

1. Add the Pinata JWT as the DHearse repository Actions secret `PINATA_JWT`.
   It is used only by the pinned release-preparation workflow to pin the tagged
   source, artwork, and metadata. Never put it in this repository or send it in
   chat.
2. Publish the GitHub release for the exact tag `v0.1.0`. The workflow prepares
   and attaches `supporter-release.json` and `supporter-metadata.json`, then
   opens a steward review issue. It does not mint or list anything.
3. Review the release assets and terms. In DecentMarket's Supporter Studio,
   import those two JSON files and connect the creator wallet on Base. The
   studio verifies the release and contract before presenting four separate
   wallet-confirmed steps: register the token, mint 1,000 editions, transfer
   them to the approved escrow, and list them at 10 USDC each. It uses the
   connected wallet; no private key is put in an `.env` or CI secret.
4. Back up the studio progress after each step. After the listing is verified,
   export the public evidence for the pinned announcement workflow to verify.

The version release includes a Pages deployment, the exact tagged-site IPFS
CID, and the `dhearse.decentagency.eth` profile. Set `SUPPORTER_ENS_NAME` to
that name before preparation so the frozen manifest binds the intended ENS
identity. The authorized Ethereum controller separately creates the subname
and sets its contenthash to the verified site CID, `avatar` to
`ipfs://SITE_CID/img/avatar.svg`, `header` to
`ipfs://SITE_CID/img/banner.svg`, and `url` to
`https://a-decent-agency.github.io/DHearse/`. Verify the records after receipts;
release preparation itself never writes ENS.

Pages and IPFS serve the public prototype interface, not the Node audio
service. Live rooms still require the documented worker configuration.
Ethereum ENS control is separate from Base Product-mint administrator
authority; never grant a role merely to get past a failed mint preflight.
Keep the announcement workflow disabled until its evidence and purchase route
are reviewed. A successful mint alone does not establish real audio delivery,
production readiness, or completion of the separate rehearsal acceptance gates.

## License and attribution

Code: Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE). Creative
works, if added later, must carry their own license and attribution. Do not
copy DecentBusking project artwork into a clone without permission.
