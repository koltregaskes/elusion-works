# Privacy host guard

Run `node scripts/check-privacy-hosts.mjs _site` after the complete build and
`node --test scripts/privacy-*.test.mjs` for offline mutations. Build CI runs the
guard after CSP compilation, so it sees the final HTML and compiled JavaScript.
Uncompiled Babel/JSX script entries fail the guard. Original `.jsx` recipes are inert
source after compilation; their generated JavaScript counterparts receive the active
reference checks. No claim is made for a partial, uncompiled bundle.
The source and helper derive from KT Photography's `docs/privacy-notice` branch.

Threat model: detect accidental undeclared static external references in the
allowlisted public bundle. Structured extraction covers complete HTML attributes,
srcset, CSS imports, URL/image-set functions, JS strings and template expressions,
comma/semicolon meta refresh, nested srcdoc and supported data URL documents.
WHATWG URL parsing resolves complete references, including base URLs, userinfo,
IDNs, whitespace and backslashes. A separate decoded-text sweep catches references
in comments and unfamiliar contexts, using `(?<![A-Za-z0-9+.-])` at scheme starts.
Navigation hosts never authorise resource loads. Reviewed non-request exceptions
are exact file/host entries with reasons; they cannot exempt structured active
references and stale entries fail. Helper output uses exact keys and known kinds;
missing Python, parse errors, depth limits, malformed data documents and symlinks
fail closed. Diagnostics report file/host only, never full URLs or input values.

This is not a JavaScript interpreter, network sandbox or proof of remote CDN
behaviour. Computed/assembled destinations, dynamic code, server redirects and
transitive CDN dependencies require review and runtime observation. A data `href`
or `url` property is treated as navigation data; changing how it is consumed needs
review. The guard does not grant permission to add a provider or publish this notice.
Browser, full build, legal/provider-retention and deployed acceptance remain separate.

No service-worker registration was found in this source edition. Any future demo
worker must register within its own demo path, handle only that path's requests,
and delete only cache names bearing that demo's unique prefix. Never claim the
shared `koltregaskes.github.io` origin or delete another project's caches.
