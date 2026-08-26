# Admin Upstream And Provider Management Design

## Goal

Complete the existing Chinese Admin Web upstream workflow without changing the
eRPC runtime or public config schema. Operators manage both fixed RPC endpoints
and eRPC's existing provider integrations from one page, without writing YAML.

## Confirmed Scope

- Keep one `上游管理` page and one unified table.
- The add drawer starts with a searchable, Chinese-grouped `接入方式` selector:
  - `自定义 RPC 节点`
  - `公共节点仓库`
  - one option for every vendor currently registered by eRPC
  - `其他 / 未收录 eRPC 厂商` as an explicit compatibility path
- Store fixed endpoints in `projects[].upstreams[]`.
- Store vendor integrations in `projects[].providers[]`.
- Support create, read, update, and delete for both record types.
- Expose every `ProviderConfig` field: `id`, `vendor`, `settings`,
  `onlyNetworks`, `ignoreNetworks`, `upstreamIdTemplate`, and `overrides`.
- Add an icon-only random-name button beside node and provider IDs.
- Keep all visible copy, field help, examples, validation, and errors in Chinese.
- Saving creates a new configuration revision. It does not restart eRPC.
- Do not add a vendor integration, Admin API, dependency, or eRPC core change.

## Source Of Truth

The runtime registry in `thirdparty/vendors_registry.go` currently registers 24
vendors:

`goldsky`, `alchemy`, `blastapi`, `conduit`, `drpc`, `dwellir`, `envio`,
`etherspot`, `infura`, `pimlico`, `quicknode`, `llama`, `thirdweb`,
`repository`, `superchain`, `tenderly`, `chainstack`, `onfinality`, `erpc`,
`blockpi`, `ankr`, `routemesh`, `blockdaemon`, and `satelink`.

The UI catalog provides these values as searchable grouped options, not as a
closed TypeScript enum. The default workflow is a dropdown; its explicit
`其他 / 未收录 eRPC 厂商` option reveals a vendor-code input so a newer eRPC
vendor can be configured before this Web build adds tailored labels. eRPC's
existing validation remains authoritative.

## Page Design

The existing quiet, dark operations layout remains unchanged. The page uses a
table because each row is an actual managed record; it does not add dashboard
cards or a separate provider page.

The table combines fixed upstream and provider rows and shows:

- name
- project
- access type (`自定义 RPC` or a vendor display name)
- endpoint for fixed nodes, or a safe settings summary for providers
- network scope for providers
- edit and delete actions

Use Ant Design's built-in pagination with a default page size of 20 so hundreds
of nodes remain usable without custom list virtualization.

The primary action is `添加上游`. Its drawer starts with a Chinese grouped
`接入方式` dropdown; selecting an option switches the form below it. Choosing
the explicit unknown-vendor option reveals a code input, while ordinary vendor
selection remains a dropdown. Editing opens the same drawer. A provider's
vendor remains editable. Converting an existing fixed node into a provider, or
the reverse, is intentionally not supported: delete the incorrect record and
add the correct type so incompatible fields are never discarded silently.

The table summary never prints credential values. Credentials remain available
for explicit viewing and editing inside the drawer.

## Random Names

The ID field has a fixed-size icon button with tooltip `随机生成`. It uses the
browser-native `crypto.randomUUID()` and adds a readable prefix:

- fixed node: `rpc-<8 hex characters>`
- provider: `<vendor>-<8 hex characters>`

Generation retries when the candidate already exists in the target project's
relevant collection. The button is available during creation and editing and
only changes the field after an explicit click.

## Fixed RPC Form

The fixed-node form keeps the existing fields:

- project
- node name
- protocol type, with open text input and `evm` / `svm` suggestions
- full HTTP or HTTPS RPC endpoint

Client validation requires a non-empty name and endpoint and rejects duplicate
node names inside the same project. It does not infer or restrict chain, vendor,
method, protocol, or domain names.

## Provider Form

The provider form exposes the full existing `ProviderConfig` contract:

- project
- provider instance name
- vendor
- vendor settings
- network scope
- generated upstream ID template
- generated-upstream overrides

The vendor selector is searchable. Known vendors show Chinese field names,
source-backed defaults, examples, and suitable controls. Changing the vendor on
an existing provider requires confirmation and resets that provider's settings
to the newly selected vendor's defaults; this prevents stale credentials and
vendor-specific keys from leaking into the replacement configuration. Secrets
remain available through an explicit password visibility toggle, matching the
previously chosen plaintext local-use policy.

Known settings include:

| Vendor | Friendly fields |
| --- | --- |
| Goldsky | secret, tier, endpoint |
| Alchemy | API key, chains URL, credit units |
| Ankr, BlastAPI, Blockdaemon, BlockPI, Dwellir, Etherspot, Infura, Llama, OnFinality, Tenderly | API key |
| Pimlico | API key, including `public` |
| Conduit | API key, networks URL |
| dRPC | API key, chains URL, credit units |
| Chainstack | API key, project, organization, region, provider, type |
| QuickNode | API key, tag IDs, tag labels, credit units |
| Envio | root domain, optional API key |
| eRPC | endpoint, optional secret |
| Thirdweb | client ID |
| Repository | repository URL |
| RouteMesh | API key, base URL |
| Superchain | registry URL |
| Satelink | optional API key |

`settings` remains an open map. Known fields are convenience controls layered
over that map; an `其他厂商参数` key/value editor preserves and edits unknown
keys. Structured known values use proper controls: tag lists for arrays and a
method/number list for `creditUnits`. Unknown non-scalar values are preserved
unchanged unless the operator explicitly replaces them.

Several vendors expose a programmatic Go `recheckInterval` setting, but the
current eRPC YAML/JSON decoding path silently falls back to the vendor default.
Because Admin revisions use that same config path, this Web form shows the
source-backed refresh default as read-only help and does not pretend that an
edited interval would take effect. Changing this runtime behavior is a separate
eRPC core change and is outside this design.

Network scope is a three-way control:

- all supported networks: omit both fields
- only selected networks: write `onlyNetworks`
- exclude selected networks: write `ignoreNetworks`

Network values are entered as tags and validated in the existing `evm:<chainId>`
format. The UI cannot produce both mutually exclusive fields.

`upstreamIdTemplate` starts with eRPC's existing
`<PROVIDER>-<NETWORK>` default. Help lists the supported placeholders without
inventing additional syntax.

`overrides` is an expandable pattern list. Each entry has a wildcard pattern
and a structured `UpstreamConfig` editor backed by the already generated config
schema. This reuses the complete field renderer rather than maintaining a
second partial upstream schema or asking the operator to write YAML.

## Data Flow

1. Load the effective document and current sparse override revision through the
   existing React Query hook.
2. Flatten `projects[].upstreams[]` and `projects[].providers[]` into
   discriminated table rows without mutating the document.
3. Open a form populated from the selected raw record. Preserve fields unknown
   to this Web build.
4. On submit, clone the effective document and change only the target project
   collection and record.
5. Convert the result back to a sparse override while retaining opaque fields.
6. Run the existing Admin configuration validation endpoint.
7. Save only a valid result against the latest locally known revision.
8. Update the local revision immediately so repeated CRUD operations do not use
   a stale base revision.

No service is restarted automatically. The runtime-control page remains the
only place that starts, stops, or restarts eRPC.

## Validation And Errors

The frontend provides immediate Chinese errors for required fields, duplicate
IDs, malformed network IDs, conflicting settings keys, invalid numeric credit
units, and missing required known-vendor credentials. The Admin validation
response is still the final authority and its error details are shown before a
save is attempted.

Deletes use the existing confirmation dialog and identify both record kind and
name. Failed validation or persistence leaves the drawer and form values open.
Successful persistence closes the drawer and reports the new revision number.

## Testing

Pure Vitest coverage will verify:

- random IDs have the correct prefix and avoid project-local collisions
- known and unknown vendor names both follow the safe path
- all 24 current runtime vendors are present as suggestions
- provider defaults and typed settings convert to the expected open settings map
- network mode writes only the selected field
- provider CRUD preserves projects, adjacent records, and opaque fields
- hundreds of fixed nodes and providers retain stable row locations
- duplicate and invalid inputs are rejected
- editing and deleting one record cannot change another project

The existing source-contract test will check the drawer wiring and Chinese
labels without adding a browser-test dependency. Final verification runs the
focused tests, the complete Web test suite, TypeScript compilation, and the
production Web build. No development server is started.

## Deliberate Non-Goals

- new eRPC vendor implementations
- a closed vendor enum
- vendor discovery through a new Admin endpoint
- automatic eRPC restart after a revision save
- importing or editing raw YAML
- automatic conversion between fixed nodes and providers
- changing provider runtime defaults or provider refresh behavior
