# Network and support placement proposal

Design only, for the December launch. No payment code or accounts.

Use Elusion Works as the network front door. Add a **Network** navigation item
pointing to `/network/`, alongside Sites, Tools, Games and Experiments. Keep the
homepage cabinet as the visual overview. Build the directory from the existing
`data/estate.js` source, extending its entries rather than creating another registry.

Each directory card has a name, one sentence, a visible status, a last editorial
update date where known, and a descriptive destination link. Group sites by
Reading, Making, Discovering and Playing. Never label a site current solely
because Pages rebuilt it.

Initial directory inventory:

| Site | Destination / decision |
| --- | --- |
| Kol's Korner | https://koltregaskes.com/ |
| KT Photography | https://koltregaskesphotography.com/ |
| Axy Lusion | https://axylusion.com/ |
| Ghost in the Models | https://ghostinthemodels.com/ |
| AI Resource Hub | https://theairesourcehub.com/ |
| Repo Foundry | https://koltregaskes.github.io/repo-foundry/ |
| GameTrackDaily | Confirm the public destination from its launch owner before linking |
| StackScout | Confirm the public destination and whether Repo Foundry replaces or complements it |
| Elusion Works | https://elusionworks.com/ |

A-List remains an Axy Lusion feature, not a second independent site. Retain the
existing demos and tools as Elusion Works sections. The tracker and estate data
do not yet agree on every launch name: reconcile that before implementing the page.

Shared footer pattern: `Part of Elusion Works` links to the umbrella, followed by
`Explore the network`, `About`, `Contact`, and the site's RSS where available.
Keep the full directory on the umbrella so each child footer stays short. Use
semantic navigation, a visible keyboard focus state, wrapping links, and 44px
comfortable hit areas at 390px. All site links have meaningful labels.

Put **Support** after the network directory and before the footer on the umbrella,
with a future `/support/` detail page. Child sites can link to that section with
`Support this site`, retaining the originating site in visible copy. Present a
brief explanation of what support funds, optional one-off support choices and
privacy information. No fake checkout buttons in the public site. Payment,
crypto and sponsorship options remain the research and approval work in hub
#1502. Newsletter subscriptions, where useful, are a separate optional action.

Suggested wireframe: header -> umbrella introduction -> network cards ->
experiments showcase -> optional support explanation -> shared footer.

Implementation acceptance: every confirmed site reachable in two links, status
and dates truthful, no duplicate registry, no horizontal overflow at 390px,
keyboard traversal works, and payment decisions approved before activation.
