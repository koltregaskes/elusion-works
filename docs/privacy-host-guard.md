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

The helper tracks SVG/MathML namespaces, integration points and breakout elements
to select foreign-content tokenisation. HTML CDATA is a bogus comment ending at
the first `>`; foreign CDATA remains text. SVG set/animate href/xlink:href targets,
including from/to/by and each semicolon-separated values candidate, are loads.

Complete URLs are canonicalised with WHATWG URL parsing before data inspection.
Scheme boundary checks also remove URL-parser-ignored tabs/newlines. A script
element rejects every data URL in src, href or xlink:href, in every namespace,
whatever the MIME, including image, binary, audio, video and font labels. Script
href aliases are also covered; prefixed active XML elements outside the supported
namespace grammar fail closed instead of becoming inert. Data
stylesheets and CSS imports are rejected at their loading boundaries. MIME case,
whitespace and JavaScript aliases are normalised; unsupported document types fail.
Supported HTML/SVG/XHTML documents are decoded without navigation or execution,
with a 32-level and 16 MiB limit, validated base64 and UTF-8/ASCII encoding. Valid
literal percentages in quoted SVG percentage attributes remain inspected; other
malformed percent escapes fail closed. Decoded document text receives the backstop.

Backstop hits require structured evidence with matching load, navigation or
metadata roles in their own source context. A declared/own-origin host or an
unrelated anchor cannot account for an unclassified active reference. Exact
file/host mention entries apply only to proven inert contexts; they never exempt
active loads or unknown source. Context records have an exact validated schema.

The source lexer proves comments and regexp literals inert. It separately checks
comments inside recognised GLSL/WGSL string literals; non-comment shader tokens
remain unclassified, and direct active calls do not acquire this status. Bounded
single-line diagnostic prose that cannot be a complete external URL can use an
explicit inert mention; ordinary URL literals and glued schemes remain checked.
If escape/newline normalisation creates a token across an inert/code boundary,
the original and inert-masked active views are both swept. Only a token absent
from the active view gains inert-artifact evidence; active/unclassified hits still
fail independently, even when the same host also appears in a comment.
Known active callees are recognised across whitespace and lexer-proven comments
without a fixed prefix-length window, including a String.raw tag. Entity
decoding is skipped only where no entity opener exists, where it is an identity.

Navigation object fields, JSON-LD/vocabulary metadata and the non-executable JSX
recipe boundary remain distinct from loads. Every emitted compiled JS file is
checked; any inline Babel/JSX entry makes the partial bundle fail. This grammar
does not certify all HTML5 tree building or subsequent computed use of metadata.
`privacy-mention-migrations.json` preserves retired namespace entries and the
exact inert-comment entries added when host-wide exemptions were removed. These
are not new resource integrations or wildcard permissions.

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
