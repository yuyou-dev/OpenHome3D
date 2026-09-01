import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

import { ONBOARDING_STEPS, RESOURCE_MIME_TYPE, RESOURCE_REGISTRY, TOOL_REGISTRY, buildPublishArgs, githubStatus, hubResult, stageDraft, takeStagedDraft } from '../mcp/server.mjs'

test('plugin exposes the community UI and guarded publisher', () => {
  assert.equal(RESOURCE_MIME_TYPE, 'text/html;profile=mcp-app')
  assert.deepEqual(TOOL_REGISTRY.map(({ descriptor }) => descriptor.name), [
    'open_openhome3d_hub',
    'check_openhome3d_github',
    'stage_openhome3d_community_draft',
    'publish_openhome3d_community_draft',
  ])
  assert.match(RESOURCE_REGISTRY[0].html, /OpenHome3D Community/)
  assert.match(RESOURCE_REGISTRY[0].html, /GitHub 官方注册页/)
  assert.match(RESOURCE_REGISTRY[0].html, /交给 Codex 整理/)
  assert.match(RESOURCE_REGISTRY[0].html, /data:image\/png;base64,/)
  assert.doesNotMatch(RESOURCE_REGISTRY[0].html, /ONBOARDING_IMAGE_DATA_URI/)
  assert.equal(RESOURCE_REGISTRY[0].uri, 'ui://openhome3d/community-hub/v2.html')
  assert.match(RESOURCE_REGISTRY[0].html, /2026-01-26/)
  assert.match(RESOURCE_REGISTRY[0].html, /ui\/notifications\/initialized/)
  assert.match(RESOURCE_REGISTRY[0].html, /ui\/notifications\/tool-input/)
  assert.match(RESOURCE_REGISTRY[0].html, /ui\/notifications\/tool-result/)
  assert.match(RESOURCE_REGISTRY[0].html, /ResizeObserver/)
})

test('hub result repeats its UI resource association', () => {
  const result = hubResult({ mode: 'community', limit: 1 })
  assert.equal(result._meta.ui.resourceUri, RESOURCE_REGISTRY[0].uri)
  assert.equal(result._meta['openai/outputTemplate'], RESOURCE_REGISTRY[0].uri)
})

test('GitHub status is finite and never exposes credentials', () => {
  const status = githubStatus()
  assert.ok(['missing_cli', 'signed_out', 'ready'].includes(status.state))
  assert.equal('token' in status, false)
  assert.equal('password' in status, false)
})

test('approved drafts route to deterministic GitHub CLI arguments', () => {
  assert.deepEqual(buildPublishArgs({ kind: 'discussion', title: 'Idea', body: 'Details', category: 'Ideas' }), [
    'discussion', 'create', '--repo', 'yuyou-dev/OpenHome3D', '--title', 'Idea', '--body', 'Details', '--category', 'Ideas',
  ])
  assert.deepEqual(buildPublishArgs({ kind: 'reply', discussionNumber: 6, body: 'Thanks' }), [
    'discussion', 'comment', '6', '--repo', 'yuyou-dev/OpenHome3D', '--body', 'Thanks',
  ])
  assert.deepEqual(buildPublishArgs({ kind: 'issue', title: 'Bug', body: 'Steps', label: 'bug' }), [
    'issue', 'create', '--repo', 'yuyou-dev/OpenHome3D', '--title', 'Bug', '--body', 'Steps', '--label', 'bug',
  ])
})

test('publication requires an exact single-use staged preview', () => {
  const staged = stageDraft({ kind: 'discussion', title: 'Share whole-home plans', body: 'It would help collaboration.', category: 'Ideas' }, 1000)
  const { approvalId, preview } = staged.structuredContent
  assert.equal(preview.title, 'Share whole-home plans')
  assert.equal(preview.body, 'It would help collaboration.')
  assert.deepEqual(takeStagedDraft(approvalId, 1001), preview)
  assert.throws(() => takeStagedDraft(approvalId, 1002), /already-used/)
  assert.throws(() => stageDraft({ kind: 'discussion', title: 'Wrong category', body: 'Body', category: 'Anything' }), /Unsupported Discussion category/)
})

test('non-UI fallback includes the complete GitHub onboarding path', () => {
  assert.equal(ONBOARDING_STEPS.length, 5)
  assert.match(ONBOARDING_STEPS.join('\n'), /gh auth login --web/)
})

test('stdio server completes MCP initialize and resource read', async (t) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  const replies = []
  let buffer = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) if (line.trim()) replies.push(JSON.parse(line))
  })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`)
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: RESOURCE_REGISTRY[0].uri } })}\n`)
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('MCP replies timed out')), 3000)
    const poll = setInterval(() => {
      if (replies.length >= 2) {
        clearInterval(poll)
        clearTimeout(deadline)
        resolve()
      }
    }, 10)
  })
  assert.equal(replies[0].result.serverInfo.name, 'openhome3d_companion')
  assert.equal(replies[1].result.contents[0].mimeType, RESOURCE_MIME_TYPE)
  assert.deepEqual(replies[1].result.contents[0]._meta['openai/widgetCSP'].redirect_domains, ['https://github.com'])
  child.stdin.end()
  await once(child, 'exit')
})

test('MCP launcher starts when Node is absent from PATH', async (t) => {
  const pluginRoot = fileURLToPath(new URL('../', import.meta.url))
  const manifest = JSON.parse(readFileSync(new URL('../.mcp.json', import.meta.url), 'utf8'))
  const config = manifest.mcpServers.openhome3d_companion
  const testHome = mkdtempSync(join(tmpdir(), 'openhome3d-companion-'))
  const bundledNode = join(testHome, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
  mkdirSync(join(bundledNode, '..'), { recursive: true })
  symlinkSync(process.execPath, bundledNode)
  t.after(() => rmSync(testHome, { recursive: true, force: true }))
  const child = spawn(config.command, config.args, {
    cwd: pluginRoot,
    env: { ...process.env, HOME: testHome, PATH: '/usr/bin:/bin' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  const lines = readline.createInterface({ input: child.stdout })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })}\n`)
  const [line] = await Promise.race([
    once(lines, 'line'),
    once(child, 'error').then(([error]) => { throw error }),
    once(child, 'exit').then(([code]) => { throw new Error(`MCP launcher exited before initialize: ${code}`) }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('MCP launcher initialize timed out')), 3000)),
  ])
  assert.equal(JSON.parse(line).result.serverInfo.name, 'openhome3d_companion')
  child.stdin.end()
  await once(child, 'exit')
  assert.equal(child.exitCode, 0)
})

test('manifest references real plugin components', () => {
  const manifest = JSON.parse(readFileSync(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'))
  assert.equal(manifest.name, 'openhome3d-companion')
  assert.equal(manifest.mcpServers, './.mcp.json')
  assert.equal(manifest.skills, './skills/')
  assert.ok(manifest.interface.capabilities.includes('MCP Apps UI'))
})

test('skills forbid treating the Apps resource as a browser URL', () => {
  for (const skill of ['openhome3d-start', 'openhome3d-contribute', 'openhome3d-maintain']) {
    const text = readFileSync(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), 'utf8')
    assert.match(text, /not a browser URL/)
    assert.match(text, /open_openhome3d_hub/)
    assert.match(text, /tool-search mechanism/)
  }
  const start = readFileSync(new URL('../skills/openhome3d-start/SKILL.md', import.meta.url), 'utf8')
  assert.match(start, /community center\/hub/)
  assert.match(start, /install, update, uninstall/)
  assert.match(start, /LIFECYCLE\.md/)
  assert.match(start, /Sources/)
  assert.match(start, /Do not switch to `oss-inbox`/)
})

test('installation requires desktop restart and explicit plugin attachment', () => {
  const text = readFileSync(new URL('../skills/openhome3d-start/references/installation.md', import.meta.url), 'utf8')
  assert.match(text, /Completely quit and reopen/)
  assert.match(text, /Use plugins/)
  assert.match(text, /ordinary prompt text does not attach/)
})

test('documentation closes the install, upgrade, and uninstall lifecycle', () => {
  const lifecycle = readFileSync(new URL('../LIFECYCLE.md', import.meta.url), 'utf8')
  assert.match(lifecycle, /## Install/)
  assert.match(lifecycle, /## Upgrade/)
  assert.match(lifecycle, /## Uninstall/)
  assert.match(lifecycle, /plugin marketplace upgrade openhome3d/)
  assert.match(lifecycle, /plugin remove openhome3d-companion@openhome3d/)

  const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8')
  assert.match(readme, /For Codex users — copy one sentence/)
  assert.match(readme, /main\/UPGRADE\.md/)
  assert.match(readme, /main\/UNINSTALL\.md/)
  assert.match(readme, /openhome3d-companion\/LIFECYCLE\.md/)
  assert.match(readme, /安装：请阅读/)
  assert.match(readme, /升级：请阅读/)
  assert.match(readme, /卸载：请阅读/)
})
