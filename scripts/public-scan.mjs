#!/usr/bin/env node
/**
 * public-scan — leak check before publishing: scan the current working tree
 * (tracked + untracked, excluding ignored files) for local home paths, private
 * host references and credential-shaped strings.
 *
 *   node scripts/public-scan.mjs
 *
 * Exit 1 with a finding list when anything matches. Patterns are deliberately
 * conservative; add new ones here when a class of private data shows up.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PATTERNS = [
  { id: 'home-path', re: /\/Users\/[A-Za-z0-9_-]+|\/home\/[A-Za-z0-9_-]+/ },
  { id: 'token-shaped', re: /ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|xox[bap]-[A-Za-z0-9-]{10,}/ },
  { id: 'private-host', re: /127\.0\.0\.1:8081|192\.168\.|10\.\d+\.\d+\.\d+/ },
]

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !/\.(png|webp|jpe?g|gif|glb|zip|ico)$/i.test(f) && f !== 'scripts/public-scan.mjs')

const findings = []
for (const f of files) {
  let text
  try {
    text = readFileSync(f, 'utf8')
  } catch {
    continue
  }
  for (const p of PATTERNS) {
    const m = text.match(p.re)
    if (m) findings.push({ file: f, pattern: p.id, match: m[0].slice(0, 60) })
  }
}

if (findings.length) {
  console.error('public-scan findings:')
  findings.forEach((f) => console.error(`  ${f.file}: ${f.pattern} — "${f.match}"`))
  process.exit(1)
}
console.log(`public-scan OK: ${files.length} working-tree files clean`)
