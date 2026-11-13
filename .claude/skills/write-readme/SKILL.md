---
name: write-readme
description: Write or improve a README or any other Markdown doc (docs/, guides) so that anyone can read it. Use when creating, auditing or rewriting a README.md or a .md file in this repository.
---

# Write README

## Philosophy

**Core principle**: A README is the front door to the project. It should answer "what is this, why should I care, and how do I use it?" within 30 seconds. Every section earns its place by serving a reader's real need — don't pad with boilerplate.

**Good READMEs** are scannable, honest, and audience-aware. They lead with a clear value proposition, show real usage examples, and respect the reader's time. A developer evaluating your project will decide in under a minute whether to invest further — the README is your pitch.

**Bad READMEs** are walls of text with no structure, auto-generated boilerplate nobody reads, or sparse one-liners that force readers to dig through source code. Equally bad: over-documented READMEs that duplicate what's in `/docs` or include every API method inline.

See [examples.md](references/examples.md) for patterns from well-regarded projects, [anti-patterns.md](references/anti-patterns.md) for common mistakes and [quality-checklist.md](references/quality-checklist.md) for validation.

For the layouting, don't hesitate to make it fun and dynamic to read using emojis, tone of voice,... without making it a joke. Make also use of emphasis with bold, italic and underline text when relevant to make your point. Reading should be dynamic so we should avoid huge blocks of content and super long sentences.

The README.md of the `hodi` repo is a good example of layouting with the first section being centered with a banner.

### Hodi house style

Learned from the maintainer's reviews. These win over the general advice above.

- **Short and light.** Keep only the key information: what it is, prerequisites, a quick start with its expected
  output, the rules, the checks, the license. Link to deeper docs (the SDK guide, `docs/`) instead of copying code
  excerpts or long explanations into the README.
- **Short sentences.** One idea per sentence, no filler. Split a sentence with two clauses into two sentences.
- **Emojis sparingly.** One in the title, and at most one set in a feature list (such as "Why start here"). None in
  other headings, rules or steps.
- **English everywhere, interface labels included.** Hodi is translated: name screens and buttons by their English
  label (`shared/locales/en.json`), such as _Server › Plugins_ and **Developer mode**, never the French
  one.
- **Screens in italics, buttons in bold.** A screen or its path is always in italics (_Settings › Sources_), with
  `›` between levels; a button or a link is in bold (**Add a source**).
- **Real paragraphs.** Short sentences, but not one paragraph per sentence: group the sentences about the same thing
  into one paragraph of two or three sentences.
- **Balanced paragraphs.** On GitHub's page width (about 140 characters a line), a paragraph's last line is never just
  a few words: reword, merge or lengthen it until the last line is at least a third full.
- **No tables.** GitHub sizes a table to its content, and its width can't be controlled. Use a short list instead,
  one item per line, or a section per entry with a sentence or two.
- **One line per list item.** Every item of a list fits on one line at GitHub's width: a bold lead, then a few words.
  Leave the details to the doc that covers them. A code block in a numbered step gets a blank line before and after.
- **Two sentences on two lines.** When two sentences of one paragraph read better on two lines, end the first with a
  backslash (`\`): a line break, not a new paragraph.
- **A public README invites.** A README read on GitHub or npm opens like a repository's: a centered header, one pitch,
  badges, a menu and a short feature list. Its details live in the types or the deeper docs, never in a long reference.
- **Diagrams in Mermaid.** A drawing of how parts connect is a `mermaid` code block, which GitHub draws, never ASCII
  art.
- **Objects unrolled.** In a code block, an object or array with more than one entry puts one entry per line, as
  `JSON.stringify(value, null, 2)` writes it: never `{ "name": "…", "lang": "fr" }` on one line.
- **No pull request numbers.** Readers can't open the private repositories' pull requests: say what changed, never
  which pull request changed it.
- **Callouts for warnings and side notes.** Use GitHub's alerts, as Hodi's README does: `> [!NOTE]` for context,
  `> [!TIP]` for a helpful extra, `> [!IMPORTANT]` for what must not be missed, `> [!WARNING]` for a risk.
- **Plain sentences first.** Don't crowd a sentence with inline code or file paths: say it in words, and keep paths
  for the code blocks.
- **The same License section everywhere**, in the form of Hodi's README: a copyright line, then one sentence naming
  the license with a link to `LICENSE`.
- **Le Claudeur is the copyright holder.** Never write the maintainer's real name in a repository: README, `LICENSE`,
  `package.json` or anywhere else.

## Modes

This skill operates in two modes:

### 1. Create — New README

For projects that have no README or need one written from scratch.

**Before writing anything:**

- [ ] Read the project's source code to understand what it does
- [ ] Identify the target audience (end users, developers, both?)
- [ ] Check for existing docs, config files, and CI setup that reveal project conventions
- [ ] Look at package.json / Cargo.toml / pyproject.toml / go.mod etc. for project metadata
- [ ] Build a source-grounded facts list: package name, entrypoints, exported functions/classes, CLI commands/flags, config keys, and required runtime versions
- [ ] For every API, command, or import you plan to document, verify it against current source or manifests before naming it
- [ ] Ask the user: "Who is this README for, and what's the one thing you want them to understand?"

**Writing process:**

- [ ] Draft the title + one-line description (the hook)
- [ ] Write a concise "What & Why" section (2-4 sentences max)
- [ ] Add a quick-start that gets the reader from zero to working in minimal steps
- [ ] Include real, tested code examples — not pseudocode
- [ ] Add installation instructions appropriate to the ecosystem
- [ ] Only add sections that this specific project needs (see the depth tiers in [examples.md](references/examples.md))
- [ ] Present draft to user for review before finalizing

### 2. Improve — Existing README

For projects with a README that needs enhancement.

**Audit first:**

- [ ] Read the current README completely
- [ ] Read the project source to check if README is accurate and current
- [ ] Run an API/CLI drift pass: extract README imports, functions, commands, flags, and config keys; compare each one to current public exports, entrypoints, and schemas
- [ ] Score against the [quality checklist](references/quality-checklist.md)
- [ ] Identify gaps, outdated content, unnecessary sections, and source-backed drift
- [ ] Present findings to user with specific recommendations and the source files/manifests that justify factual corrections

**Then improve:**

- [ ] Fix factual inaccuracies first (wrong install commands, outdated API examples), citing the source file or manifest that proves the correction
- [ ] Address structural issues (missing sections, poor ordering)
- [ ] Improve clarity and scannability (headers, code blocks, lists)
- [ ] Remove boilerplate that adds no value
- [ ] Rewrite stale examples with current imports, functions, signatures, and commands only after confirming they are exported or defined; do not invent compatibility wrappers for missing names
- [ ] Verify all code examples work, or state which checks could not be run
- [ ] Present changes to user for approval

## Key Principles

1. **Lead with value** — The first 3 lines determine if someone keeps reading
2. **Show, don't tell** — Code examples > prose descriptions
3. **Be honest about scope** — State what the project does AND what it doesn't do
4. **Respect ecosystem conventions** — npm projects look different from Rust crates
5. **Keep it maintained** — A README that lies is worse than no README
6. **Link, don't duplicate** — Point to docs/ for deep dives, keep the README focused
7. **Test your examples** — Broken code examples destroy trust instantly
8. **Source beats memory** — Treat README examples, previous docs, and model memory as suspect until checked against current source and manifests

## Source-Grounded API Drift Protocol

Use this protocol whenever a README mentions functions, classes, imports, CLI commands, flags, config keys, or examples that may have drifted from the code.

1. **Extract documented symbols** — List every README import, public API name, command, flag, option, and config key before editing.
2. **Find authoritative definitions** — Check package manifests (`exports`, `bin`, entrypoints), public export files (`__init__.py`, `index.ts`, `lib.rs`, `go.mod` module path), CLI parsers, config schemas, and type declarations.
3. **Confirm existence and signature** — Search for definitions, not just string occurrences. Verify import paths, parameter names, required options, return/output shape, and deprecation notes.
4. **Classify drift explicitly** — Mark each mismatch as renamed, removed, moved, changed signature, undocumented, or ambiguous. Include source file evidence such as `src/package/__init__.py` or `package.json#bin`.
5. **Rewrite from source, not guesses** — Replace stale examples with the current exported API. Mention the old name only as a drift/migration note; never present it as current unless source proves compatibility.
6. **Handle uncertainty honestly** — If source does not reveal the replacement, say so and ask the user or leave a placeholder note for maintainers. Do not hallucinate a wrapper, alias, benchmark, compatibility claim, or implementation.
7. **Verify the corrected snippet** — Run the documented command/example when feasible. If not, state the exact verification not run.

When reporting an audit, include a compact "Source checked" note or table for API drift findings: stale README symbol, current source symbol, evidence file, and corrected snippet.

## Per-Section Checklist

```
[ ] Title is clear and descriptive (not clever)
[ ] One-liner explains what + why in plain language
[ ] Quick-start gets reader to "it works" in ≤5 steps
[ ] Code examples are real, tested, and copy-pasteable
[ ] Installation covers the project's actual ecosystem
[ ] No orphan sections (every section serves a purpose)
[ ] Badges are useful, not decorative
[ ] License is stated
[ ] Contributing section exists if accepting contributions
```
