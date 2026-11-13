# Hello world

The SDK's test plugin: two settings that Hodi draws, a server route with its own table, and a card under its options
in _Server › Plugins_, in French and English.

It guards the plugin API. `npm run typecheck` checks it against Hodi's own components, and
`server/test/plugin-sdk.test.ts` builds, unpacks and runs it, so a change that would break plugins fails CI.

> [!TIP]
> To write a plugin, start from [`hodi-plugin-template`](https://github.com/leclaudeur/hodi-plugin-template) instead.

## Try it

On a Hodi started from this clone, turn on _Server › Plugins › Developer mode_ and copy its code. Then, from the
repository's root:

```bash
npm run plugin:build -- dev plugin-sdk/test/hello-world --server http://localhost:3000 --code <code>
```

The plugin shows as **In development**, with its card under its options. An unsigned build from
`npm run plugin:build -- plugin-sdk/test/hello-world` installs through **Add a plugin** too, but without its card.

[← Back to the plugin SDK](../../README.md)
