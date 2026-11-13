# Code conventions

How Hodi's code is written: names, structure and comments. These rules hold in this repository and in Hodi's plugins
(`hodi-plugin-*`), and Prettier decides everything about formatting.

The reference behind them is the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html):
where Hodi differs, this page wins. A rule marked _planned_ becomes a lint rule once the code follows it, but new code
follows it now.

## Names

- **Variables and functions**: `camelCase`, a verb for an action and a noun for a value (`loadProfiles`, `profiles`)
- **Booleans**: start with `is`, `has`, `can` or `should` (`isAdmin`, `hasAccount`)
- **Fixed values**: `SCREAMING_CASE`, with the unit as a suffix (`MAX_SAVED`, `DAY_MS`)
- **Types and components**: `PascalCase`, with no `I` or `T` prefix (`Profile`, `SourceStore`)
- **Props**: an `interface XxxProps` next to the component, never inline
- **Errors**: end with `Error` (`SqlRefusedError`)
- **Event handlers**: a prop `onXxx`, a local function `handleXxx`
- **Files**: `PascalCase.tsx` for a component, `kebab-case.ts` otherwise (`use-media.ts`)
- **Ids and routes**: always in English (`#/settings/household`)

Files with one job say it in their suffix: `*-store.ts` for a kind of data, `*-routes.ts` for a group of routes and
`use-*.ts` for a hook.

## Structure

A module has one job. A file holds **300 lines** of code at most, a function or a component **80**, and its cognitive
complexity stays under **15**, without counting blank lines and comments. The only exception is
`server/db/migrations.ts`, a list that only grows. ESLint checks all three, and `npm run lint` fails as soon as a file or a function goes over.

- **Components**: one that grows becomes a folder of smaller parts (`Reader/`), its logic in a `use-*.ts` hook
- **Routes**: every route lives in a `server/http/*-routes.ts`, and `server/app.ts` only puts them together
- **Input**: every request body and outside payload goes through a `zod` schema where it enters
- **API calls**: through `web/src/api.ts`, never a `fetch` in a component (plugins' `sdk.ts` apart)
- **Shared code**: what both the server and the web app need lives in `shared/`
- **Imports**: Node, packages, the project, then CSS, with no cycle (_planned_)
- **Exports**: `export default` for a `.tsx` file's component, named exports elsewhere (_planned_)

## Code

- **Functions**: arrow functions, and a class only for a store, a service that holds state or an error
- **Types**: `interface` for an object's shape, `type` for a union or a helper type
- **Equality**: `===` everywhere, except `== null` for both `null` and `undefined`
- **Ternaries**: never nested, use an `if`, a lookup object or a small function (_planned_)
- **Safety**: no `any`, and no non-null `!` without a comment saying why
- **Lint exceptions**: every `eslint-disable` gives its reason after `--`

## Comments

The name says **what**, the comment says **why**. A comment that repeats the code or the name is deleted, and one
longer than **two lines** usually means a better name or one more function is needed. Write one only for a choice that is not obvious, an outside constraint (security, a browser, a third-party API), a
product rule written in code, or a workaround.

- **No product story**: that belongs in [features.md](features.md), a module gets one line on its job at most
- **No JSDoc**: except in the public SDK, where a plugin author's editor shows it
- **No history**: no thread or mock-up names, no "we used to", which go in the commit
- **French labels**: quoting one (« Qui lit ? ») is fine, it helps find the screen

[← Back to the README](../README.md)
