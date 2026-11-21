# Third-party development skills

The skill directories below are vendored from their upstream projects for
development use. Their source commits and content hashes are recorded in
`../skills-lock.json`. The upstream skill files are unmodified.

| Installed directory | Upstream source | License evidence |
| --- | --- | --- |
| `skills/find-skills` | [Vercel Skills](https://github.com/vercel-labs/skills/tree/57217cf86ba38148a57af9e90d14a4c049558330/skills/find-skills) | MIT. See [LICENSE](licenses/vercel-skills-LICENSE.txt). |
| `skills/grill-me`, `skills/grilling` | [Matt Pocock's skills](https://github.com/mattpocock/skills/tree/abeeaf95660ba9e8b7c753eb38f441ca707a8823/skills/productivity) | MIT. See [LICENSE](licenses/mattpocock-skills-LICENSE.txt). |
| `skills/frontend-design` | [Anthropic skills](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/frontend-design) | Apache-2.0; original [LICENSE.txt](skills/frontend-design/LICENSE.txt) included |
| `skills/web-design-guidelines` | [Vercel agent skills](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines) | Upstream [README](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/README.md) states MIT; no root LICENSE file is present in that source snapshot |
| `skills/playwright-cli` | [Microsoft Playwright CLI](https://github.com/microsoft/playwright-cli/tree/99c4eb2566153f37fb104e5dbf894fb9c785e17d/skills/playwright-cli) | Apache-2.0; original [LICENSE](licenses/playwright-cli-LICENSE.txt) included |
| `skills/electron` | [Vercel Labs agent-browser](https://github.com/vercel-labs/agent-browser/tree/deda8eff5e29bcc3b4a9f10aafd1412dbe91745a/skill-data/electron) | Apache-2.0; original [LICENSE](licenses/agent-browser-LICENSE.txt) included |
| `skills/systematic-debugging`, `skills/verification-before-completion` | [Superpowers](https://github.com/obra/superpowers/tree/22f0b463e7a5e579904dd6211a520321035526f7/skills) | MIT, copyright (c) 2025 Jesse Vincent; original [LICENSE](licenses/superpowers-LICENSE.txt) included |
| `skills/game-ui-ux`, `skills/steam-publish` | [Game UI/UX](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/c6ca6c41c839b68319ffc08430b99ab768debc32/skills/disciplines/game-ui-ux) and [Steam Publish](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/c6ca6c41c839b68319ffc08430b99ab768debc32/skills/workflows/steam-publish) | Apache-2.0. See the upstream [LICENSE](licenses/gamedev-skills-LICENSE.txt) and [NOTICE](licenses/gamedev-skills-NOTICE.txt). |
| `skills/electron-builder` | [Pedro Nauck's skills](https://github.com/pedronauck/skills/tree/93655db210f1860822215d5a9bd86f580ffb1239/skills/curated/electron-builder) | MIT. See the upstream [LICENSE](licenses/pedronauck-skills-LICENSE.txt). |

Root license copies are kept outside individual skill directories so the
installer's recorded skill-content hashes continue to match upstream files.
The Windows application packager includes only its explicit runtime source
list; these development instructions are not part of that list.
