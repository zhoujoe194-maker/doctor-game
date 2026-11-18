# Third-party development skills

The skill directories below are vendored from their upstream projects for
development use. Their source commits and content hashes are recorded in
`../skills-lock.json`. The upstream skill files are unmodified.

| Installed directory | Upstream source | License evidence |
| --- | --- | --- |
| `skills/frontend-design` | [Anthropic skills](https://github.com/anthropics/skills/tree/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/frontend-design) | Apache-2.0; original [LICENSE.txt](skills/frontend-design/LICENSE.txt) included |
| `skills/web-design-guidelines` | [Vercel agent skills](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/web-design-guidelines) | Upstream [README](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/README.md) states MIT; no root LICENSE file is present in that source snapshot |
| `skills/playwright-cli` | [Microsoft Playwright CLI](https://github.com/microsoft/playwright-cli/tree/99c4eb2566153f37fb104e5dbf894fb9c785e17d/skills/playwright-cli) | Apache-2.0; original [LICENSE](licenses/playwright-cli-LICENSE.txt) included |
| `skills/electron` | [Vercel Labs agent-browser](https://github.com/vercel-labs/agent-browser/tree/deda8eff5e29bcc3b4a9f10aafd1412dbe91745a/skill-data/electron) | Apache-2.0; original [LICENSE](licenses/agent-browser-LICENSE.txt) included |
| `skills/systematic-debugging`, `skills/verification-before-completion` | [Superpowers](https://github.com/obra/superpowers/tree/22f0b463e7a5e579904dd6211a520321035526f7/skills) | MIT, copyright (c) 2025 Jesse Vincent; original [LICENSE](licenses/superpowers-LICENSE.txt) included |

Root license copies are kept outside individual skill directories so the
installer's recorded skill-content hashes continue to match upstream files.
The Windows application packager includes only its explicit runtime source
list; these development instructions are not part of that list.
