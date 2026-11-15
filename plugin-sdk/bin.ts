#!/usr/bin/env node
import { run } from './cli.ts'

// The hodi-plugin command (and npm run plugin:build in Hodi's repository).
await run(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
