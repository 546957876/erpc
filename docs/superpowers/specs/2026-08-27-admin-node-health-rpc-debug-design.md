# Admin Node Health And RPC Debug Design

## Goal

Add a Chinese node-health workspace and RPC request debugger to Admin Web while
keeping eRPC itself unchanged. Operators can see the configured health timing,
inspect the running topology, test a saved static endpoint before restart, and
test either the running eRPC pool or one running upstream.

## Confirmed Decisions

- Reuse the existing topology page and rename it `节点健康`; do not add a
  second topology/health page.
- Add one separate `RPC 调试` page.
- Support both test paths:
  - `已保存配置直连`: read a static endpoint from an exact PostgreSQL revision,
    so a newly saved endpoint can be tested before eRPC restarts.
  - `运行中 eRPC 代理`: send through a registered eRPC target, optionally with
    `X-ERPC-Use-Upstream` and always with `X-ERPC-Skip-Cache-Read: true`.
- Keep project IDs, network IDs, methods, vendors, and response bodies open
  strings. Presets fill values but never restrict custom input.
- Do not modify the eRPC core, public YAML schema, PostgreSQL schema, or runtime
  manager. Do not add a frontend or backend dependency.

## Admin APIs

### Saved Static Endpoint

`POST /api/config/upstreams/test`

```json
{
  "revision": 12,
  "projectId": "main",
  "upstreamId": "bsc-mainnet-1",
  "method": "eth_chainId",
  "params": []
}
```

The handler loads the exact revision, finds one unambiguous project and static
upstream, resolves the endpoint fallback and all-or-nothing `jsonRpc` block
inheritance from `upstreamDefaults` used by eRPC, expands environment variables
with the Admin process environment, validates the endpoint as an
absolute HTTP(S) URL, and sends the JSON-RPC request directly. Saved headers
stay server-side and are never returned to the browser. Provider instances are
not expanded by Admin and must be tested through running eRPC after their
revision is applied.

The browser cannot submit an arbitrary URL. This keeps the operation limited to
the authenticated operator's saved configuration. Private and loopback targets
remain valid because local/internal RPC endpoints are an intended deployment.

### Running eRPC

`POST /api/targets/{targetId}/rpc-test`

```json
{
  "projectId": "main",
  "networkId": "evm:56",
  "upstreamId": "bsc-mainnet-1",
  "projectSecret": "optional-project-secret",
  "method": "eth_chainId",
  "params": []
}
```

`upstreamId` and `projectSecret` are optional. A supplied project secret is used
only for this data-plane request; the target's Admin credential is never reused
outside `/admin`. The Admin client sends `networkId` in the JSON-RPC
body, which eRPC natively supports and which preserves unknown architectures
and multi-part network identifiers. When an upstream is requested, the client
adds `X-ERPC-Use-Upstream`; it always adds
`X-ERPC-Skip-Cache-Read: true`. The response reports the actual diagnostic
headers so the UI can distinguish a confirmed match from a directive that the
project configuration did not allow. Both directives remain subject to the
project's `allowClientDirectives` policy.

Both APIs return HTTP status, duration, response body text, and the safe eRPC
diagnostic headers `X-ERPC-Upstream`, `X-ERPC-Upstreams`, and `X-ERPC-Cache`.
Non-2xx status from the tested service remains result data. Network, timeout,
oversized-response, and read failures become an opaque Admin 502 without
including endpoint credentials.

## Node Health Page

The existing target list and target detail become `节点健康`. Old
`/topology/*` and `/targets/*` routes redirect to the new route.

The target detail keeps the current project/network/upstream table, health
drawer, and cordon controls. It adds:

- a quick test action for a running upstream, initially shown as `未测试` and
  marked successful only when the response diagnostic identifies that exact
  upstream;
- project-scoped health timing controls backed by the current revision:
  - EVM state poll interval;
  - selection-policy evaluation interval;
  - rolling score-metrics window;
  - SVM state-poller debounce;
- explicit copy that changes create a new revision and require an eRPC restart;
- separate wording for Admin topology polling so it is not confused with eRPC
  upstream state polling.

Values are loaded from `effectivePayload`, so source-backed defaults such as
`30s`, `15s`, and `400ms` appear without requiring the operator to enter them.
Saving uses the existing sparse override extraction, validation, revision
conflict handling, and dirty-state guard. The UI does not claim that
`statePollerInterval: 0` disables polling because the current eRPC loader
normalizes or rejects zero.

## RPC Debug Page

The page uses a segmented control for the two test sources. It provides:

- exact revision/project/static-upstream selectors in direct mode;
- target/project/network/running-upstream selectors in runtime mode;
- an open network input with convenience presets:
  - Ethereum mainnet: `evm:1`;
  - BSC mainnet: `evm:56`;
  - Robinhood mainnet: `evm:4663`;
  - Solana mainnet: `svm:mainnet-beta`;
- an open JSON-RPC method input;
- JSON array/object params input;
- a derived public URL in the standard
  `/<project>/<architecture>/<network>` form;
- copyable URL, PowerShell request, and curl request;
- an optional project Secret input; copied commands use `<PROJECT_SECRET>` by
  default and include the real value only after an explicit switch;
- result status, duration, matched upstream diagnostics, and formatted or raw
  response text.

The public base URL initially derives from the browser hostname and the eRPC
HTTP port in the effective config. It remains editable for a server IP, domain,
or reverse proxy. Persisting that display-only override is deliberately outside
this phase because it is not part of eRPC configuration and is not required to
send or copy a correct request.

## Upstream Table

Static rows receive a one-click `测试` action that calls the saved-revision API.
EVM rows use `eth_chainId`; SVM rows use `getHealth`. Unknown protocols are not
guessed and instead direct the operator to `RPC 调试`, where the method remains
open. Provider rows are tested after application through the running topology.

## Testing

- Go tests cover authentication, exact revision lookup, duplicate identifiers,
  invalid/missing endpoints, unknown network/method pass-through, request
  directives, diagnostic headers, non-2xx tested responses, response limits,
  and opaque transport failures.
- Vitest covers both API paths, four presets, open network/method values, params
  parsing, URL/command generation, response formatting, health-setting updates,
  unknown-field preservation, and no-change save behavior.
- Existing large upstream CRUD tests remain part of the regression suite.
- Final checks run Admin tests/vet/build, Web tests/build, `git diff --check`,
  and desktop/mobile browser verification.

## Non-Goals

- changing eRPC state-poller semantics or defaults;
- arbitrary URL proxying;
- provider endpoint construction in Admin;
- automatic restart after save;
- request history, scheduled synthetic probes, alerts, or a second health
  database;
- a closed list of supported chains, methods, or architectures.
