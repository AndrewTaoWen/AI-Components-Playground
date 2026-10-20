# AI Components Playground

An independent React + TypeScript app for trying AI Components in ordinary workflows. It consumes
`@ai-components/react` as a packaged dependency, with no source aliases, symlinks, or unpublished
GitHub branch installation required.

## Run

Use Node 22.12+ (or a current supported Node release).

```sh
npm ci
npm run dev
```

Open [the local playground](http://127.0.0.1:5180). Mock mode works immediately without an API key.
Sample outputs are deterministic fixtures, not live AI. The app includes all 13 examples: search,
writing, autocomplete, semantic select, form autofill, tags, filters, rewrite actions, dates,
field mapping, multi-select, workflow memory, and change previews.

## Try these flows

### Shared context between controls

1. Open **Workflow memory**.
2. Enter `Name: Alex Chen` and `Company: Northwind` on separate lines in Customer details.
3. Click **Suggest field values**, then **Apply values**.
4. Click **Shorten** below the separate reply field. The proposed reply borrows the accepted name
   and company; the original field stays unchanged until **Use rewrite**.
5. Expand **Inspect assembled request** to see selected memory, action provenance, and downstream-use hints.

### Review the next step of a form

1. Open **Change preview** and click **Suggest next steps**.
2. Uncheck **Priority**, then click **Apply selected (2)**.
3. Category and reply change together; priority remains Normal.
4. Click **Undo AI changes** to restore the accepted batch.
5. Apply another batch, manually edit an affected field, and see that undo becomes unavailable.

The right-hand shared configuration panel controls inherited prompts and enables/disables AI.
Mocks return fixed examples; arbitrary prompt engineering needs a live backend.

## Use a real backend

The playground deliberately contains no model-provider credentials or SDK. Keep keys in your own
backend. That backend should serve `POST /api/ai` and implement the library's `AIRequest` →
`AIResponse` contract. It must support the request actions and response shapes used by the examples.

```sh
cp .env.example .env
# Set AI_BACKEND_URL=http://127.0.0.1:3000 in .env, then restart the dev server.
npm run dev
```

Toggle **Use /api/ai endpoint** in the shared configuration panel. The Vite development server
proxies requests to `/api/ai` on that backend origin. It does not provide an AI backend itself.
This proxy is development-only; production hosting needs its own API routing and authentication.
Never put secrets in `VITE_*` variables.

Requests include `action`, `text`, `prompt`, optional `instruction`, and selected `context`.
Responses contain `text` and optional structured `data`. For change previews, return:

```json
{
  "text": "",
  "data": {
    "changes": [{ "field": "category", "value": "Billing", "reason": "This is a charge issue." }]
  }
}
```

The library README bundled in the dependency documents the other component contracts. Also see
[the library repository](https://github.com/AndrewTaoWen/AI-Components).

## Library snapshot and updates

`vendor/ai-components-react-045ec1b.tgz` contains the library build from commit
`045ec1b7cb272d7ed9fde5b7d665cd026adc1b2b`, including
[shared memory #8](https://github.com/AndrewTaoWen/AI-Components/pull/8) and
[reviewable suggestions #9](https://github.com/AndrewTaoWen/AI-Components/pull/9).
These features do not need to be merged or published to npm to test them here.
The tarball includes the library's MIT license and README; only the built package is vendored.

After editing a local library checkout (install its dependencies first), refresh the package:

```sh
# Defaults to a sibling ../AI-Components checkout:
npm run update:library
# Or supply a path:
npm run update:library -- /absolute/path/to/AI-Components
npm test
npm run build
```

The script runs the library's `npm pack` build, adds a content-addressed tarball to `vendor`,
updates the dependency and lockfile, and installs it. Commit all three together to share the update.
It does not automatically sync future demo source changes into this app.

## Checks

```sh
npm test
npm run build
npm run format:check
```

Consumer integration tests exercise shared memory and selective acceptance/undo against the packaged
library. GitHub Actions runs the same checks. `npm run preview` serves the production frontend build
on port 5180; mock mode also works there.
