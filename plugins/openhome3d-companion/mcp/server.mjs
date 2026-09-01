#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import readline from 'node:readline'

const SERVER_VERSION = '0.1.0'
const REPOSITORY = 'yuyou-dev/OpenHome3D'
const HUB_URI = 'ui://openhome3d/community-hub/v2.html'
const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app'
const onboardingImage = `data:image/png;base64,${readFileSync(new URL('../assets/github-onboarding.png', import.meta.url)).toString('base64')}`
const hubHtml = readFileSync(new URL('./community-hub.html', import.meta.url), 'utf8')
  .replace('{{ONBOARDING_IMAGE_DATA_URI}}', onboardingImage)
const ONBOARDING_STEPS = [
  'Open https://github.com/signup in a browser.',
  'Create a free personal account with email, password, and a public username.',
  'Personally complete CAPTCHA and email verification; never share codes with Codex.',
  'Enable two-factor authentication and store recovery codes privately.',
  'Return to Codex, run gh auth login --web, and verify with gh auth status.',
]
const DISCUSSION_CATEGORIES = new Set(['Ideas', 'Q&A', 'Show and tell'])
const stagedDrafts = new Map()

function run(command, args, timeout = 15000) {
  return spawnSync(command, args, { encoding: 'utf8', timeout })
}

function githubStatus() {
  const version = run('gh', ['--version'], 3000)
  if (version.error?.code === 'ENOENT') {
    return { state: 'missing_cli', label: 'GitHub CLI is not installed' }
  }
  const auth = run('gh', ['auth', 'status'], 5000)
  if (auth.status !== 0) {
    return { state: 'signed_out', label: 'GitHub account is not connected' }
  }
  const login = run('gh', ['api', 'user', '--jq', '.login'], 5000)
  return {
    state: 'ready',
    label: 'GitHub is connected',
    login: login.status === 0 ? login.stdout.trim() : undefined,
  }
}

const DISCUSSIONS_QUERY = `query($owner:String!,$name:String!,$first:Int!){
  repository(owner:$owner,name:$name){
    discussions(first:$first,orderBy:{field:UPDATED_AT,direction:DESC}){
      nodes{number title url createdAt updatedAt isAnswered category{name} author{login} comments{totalCount}}
    }
  }
}`

function listDiscussions(limit = 20) {
  const status = githubStatus()
  if (status.state !== 'ready') return { status, discussions: [] }
  const result = run('gh', [
    'api', 'graphql',
    '-f', `query=${DISCUSSIONS_QUERY}`,
    '-F', 'owner=yuyou-dev',
    '-F', 'name=OpenHome3D',
    '-F', `first=${Math.max(1, Math.min(Number(limit) || 20, 50))}`,
  ])
  if (result.status !== 0) {
    return {
      status,
      discussions: [],
      warning: result.stderr.trim().split('\n')[0] || 'Unable to load GitHub Discussions',
    }
  }
  const parsed = JSON.parse(result.stdout)
  return { status, discussions: parsed.data?.repository?.discussions?.nodes || [] }
}

function hubResult(arguments_ = {}) {
  const data = listDiscussions(arguments_.limit)
  const mode = ['community', 'onboarding', 'contribute'].includes(arguments_.mode)
    ? arguments_.mode
    : 'community'
  const structuredContent = {
    repository: REPOSITORY,
    repositoryUrl: `https://github.com/${REPOSITORY}`,
    discussionsUrl: `https://github.com/${REPOSITORY}/discussions`,
    signupUrl: 'https://github.com/signup',
    mode,
    onboardingSteps: ONBOARDING_STEPS,
    textualFallback: 'Without Apps UI: use onboardingSteps for GitHub setup; draft in conversation; stage the exact final text; obtain explicit user confirmation; then publish only the staged draft ID.',
    ...data,
  }
  return {
    structuredContent,
    content: [{
      type: 'text',
      text: data.status.state === 'ready'
        ? `OpenHome3D community hub loaded with ${data.discussions.length} recent discussions. Draft, stage, preview, obtain explicit confirmation, then publish the unchanged staged draft.`
        : `OpenHome3D community hub loaded. GitHub setup is needed before posting or replying.\n${ONBOARDING_STEPS.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
    }],
    _meta: {
      ui: { resourceUri: HUB_URI },
      'openai/outputTemplate': HUB_URI,
    },
  }
}

const hubTool = {
  name: 'open_openhome3d_hub',
  title: 'Open OpenHome3D community hub',
  description: 'Open the interactive OpenHome3D community UI. Use it to browse recent GitHub Discussions, guide a newcomer through GitHub signup, or draft a discussion/reply without requiring Git knowledge. The UI never publishes directly: it sends a draft back to Codex for review and explicit user confirmation.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['community', 'onboarding', 'contribute'] },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  _meta: {
    ui: { resourceUri: HUB_URI },
    'openai/outputTemplate': HUB_URI,
    'openai/toolInvocation/invoking': '正在打开 OpenHome3D 社区',
    'openai/toolInvocation/invoked': 'OpenHome3D 社区已就绪',
  },
}

const statusTool = {
  name: 'check_openhome3d_github',
  title: 'Check OpenHome3D GitHub connection',
  description: 'Check whether GitHub CLI exists and is authenticated. This is read-only and never reads credential files.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true, openWorldHint: false },
}

const publishTool = {
  name: 'publish_openhome3d_community_draft',
  title: 'Publish an approved OpenHome3D community draft',
  description: 'Publish one staged OpenHome3D community draft by approval ID. Call only after stage_openhome3d_community_draft returned the exact preview and the user explicitly confirmed that preview. The ID expires and can be used once; the publisher cannot alter the staged destination, title, category, or body.',
  inputSchema: {
    type: 'object',
    required: ['approvalId'],
    properties: {
      approvalId: { type: 'string', minLength: 1, description: 'Single-use ID returned by stage_openhome3d_community_draft.' },
    },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}

const stageTool = {
  name: 'stage_openhome3d_community_draft',
  title: 'Stage an OpenHome3D community draft for approval',
  description: 'Lock one exact Discussion, reply, or Issue draft and return a preview plus a single-use approval ID. This does not contact GitHub or publish anything. Show the returned preview to the user and wait for explicit confirmation before calling the publisher.',
  inputSchema: {
    type: 'object',
    required: ['kind', 'body'],
    properties: {
      kind: { type: 'string', enum: ['discussion', 'reply', 'issue'] },
      title: { type: 'string', minLength: 1, maxLength: 160 },
      body: { type: 'string', minLength: 1 },
      category: { type: 'string', enum: ['Ideas', 'Q&A', 'Show and tell'] },
      discussionNumber: { type: 'integer', minimum: 1 },
      label: { type: 'string', description: 'Optional existing GitHub Issue label.' },
    },
    allOf: [
      { if: { properties: { kind: { const: 'discussion' } } }, then: { required: ['title', 'category'] } },
      { if: { properties: { kind: { const: 'reply' } } }, then: { required: ['discussionNumber'] } },
      { if: { properties: { kind: { const: 'issue' } } }, then: { required: ['title'] } },
    ],
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}

function buildPublishArgs(arguments_) {
  const { kind, title, body, category, discussionNumber, label } = arguments_
  let args
  if (kind === 'discussion') {
    args = ['discussion', 'create', '--repo', REPOSITORY, '--title', title, '--body', body, '--category', category]
  } else if (kind === 'reply') {
    args = ['discussion', 'comment', String(discussionNumber), '--repo', REPOSITORY, '--body', body]
  } else if (kind === 'issue') {
    args = ['issue', 'create', '--repo', REPOSITORY, '--title', title, '--body', body]
    if (label) args.push('--label', label)
  } else {
    throw new Error('Unsupported community draft kind')
  }
  return args
}

function validateDraft(draft) {
  if (!['discussion', 'reply', 'issue'].includes(draft.kind)) throw new Error('Unsupported community draft kind')
  if (typeof draft.body !== 'string' || !draft.body.trim()) throw new Error('Draft body is required')
  if (draft.kind !== 'reply' && (typeof draft.title !== 'string' || !draft.title.trim())) throw new Error('Draft title is required')
  if (draft.kind === 'discussion' && !DISCUSSION_CATEGORIES.has(draft.category)) throw new Error('Unsupported Discussion category')
  if (draft.kind === 'reply' && (!Number.isInteger(draft.discussionNumber) || draft.discussionNumber < 1)) throw new Error('Discussion number is required')
}

function stageDraft(arguments_, now = Date.now()) {
  validateDraft(arguments_)
  buildPublishArgs(arguments_)
  const approvalId = randomUUID()
  const expiresAt = now + 30 * 60 * 1000
  const draft = { ...arguments_, approvalId, expiresAt }
  stagedDrafts.set(approvalId, draft)
  return {
    structuredContent: { repository: REPOSITORY, approvalId, expiresAt, preview: draft },
    content: [{
      type: 'text',
      text: `Staged OpenHome3D ${draft.kind} draft ${approvalId}. Show this exact preview and wait for explicit confirmation before publishing.\n${draft.title ? `Title: ${draft.title}\n` : ''}${draft.category ? `Category: ${draft.category}\n` : ''}${draft.discussionNumber ? `Discussion: #${draft.discussionNumber}\n` : ''}Body:\n${draft.body}`,
    }],
  }
}

function takeStagedDraft(approvalId, now = Date.now()) {
  const draft = stagedDrafts.get(approvalId)
  stagedDrafts.delete(approvalId)
  if (!draft) throw new Error('Unknown or already-used approval ID; stage the draft again')
  if (draft.expiresAt < now) throw new Error('Approval ID expired; stage and preview the draft again')
  return draft
}

function publishDraft({ approvalId }) {
  const status = githubStatus()
  if (status.state !== 'ready') throw new Error('Connect a GitHub account before publishing')
  const draft = takeStagedDraft(approvalId)
  const { kind } = draft
  const args = buildPublishArgs(draft)
  const result = run('gh', args, 30000)
  if (result.status !== 0) throw new Error(result.stderr.trim().split('\n')[0] || 'GitHub rejected the publication')
  const output = result.stdout.trim()
  const url = output.match(/https:\/\/github\.com\/[^\s]+/)?.[0]
  return {
    structuredContent: { repository: REPOSITORY, kind, url, output },
    content: [{ type: 'text', text: url ? `Published to OpenHome3D: ${url}` : `Published to OpenHome3D. ${output}` }],
  }
}

const TOOL_REGISTRY = [
  { descriptor: hubTool, run: hubResult },
  {
    descriptor: statusTool,
    run: () => {
      const status = githubStatus()
      return {
        structuredContent: { repository: REPOSITORY, status },
        content: [{ type: 'text', text: status.login ? `${status.label} as ${status.login}.` : `${status.label}.` }],
      }
    },
  },
  { descriptor: stageTool, run: stageDraft },
  { descriptor: publishTool, run: publishDraft },
]

const RESOURCE_REGISTRY = [{
  uri: HUB_URI,
  name: 'OpenHome3D community hub',
  description: 'Community browser, neutral GitHub onboarding guide, and contribution draft composer.',
  html: hubHtml,
}]

function errorResult(error) {
  return { isError: true, content: [{ type: 'text', text: `OpenHome3D Companion: ${error.message}` }] }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || message.method?.startsWith('notifications/')) return
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'openhome3d_companion', version: SERVER_VERSION },
        instructions: 'Use open_openhome3d_hub for the visual OpenHome3D community, GitHub onboarding, and contribution drafting experience. Without UI, use its onboardingSteps and textualFallback. A form submission is not authorization. Stage the exact final draft, show the staged preview, wait for explicit user confirmation, then publish only its single-use approval ID.',
      },
    })
    return
  }
  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOL_REGISTRY.map(({ descriptor }) => descriptor) } })
    return
  }
  if (message.method === 'tools/call') {
    const entry = TOOL_REGISTRY.find(({ descriptor }) => descriptor.name === message.params?.name)
    if (!entry) {
      send({ jsonrpc: '2.0', id: message.id, result: errorResult(new Error('unknown tool')) })
      return
    }
    try {
      send({ jsonrpc: '2.0', id: message.id, result: await entry.run(message.params?.arguments || {}) })
    } catch (error) {
      send({ jsonrpc: '2.0', id: message.id, result: errorResult(error) })
    }
    return
  }
  if (message.method === 'resources/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { resources: RESOURCE_REGISTRY.map(({ uri, name, description }) => ({ uri, name, description, mimeType: RESOURCE_MIME_TYPE })) },
    })
    return
  }
  if (message.method === 'resources/read') {
    const resource = RESOURCE_REGISTRY.find((entry) => entry.uri === message.params?.uri)
    if (!resource) {
      send({ jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'resource not found' } })
      return
    }
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        contents: [{
          uri: resource.uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: resource.html,
          _meta: {
            ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
            'openai/widgetPrefersBorder': false,
            'openai/widgetCSP': { connect_domains: [], resource_domains: [], redirect_domains: ['https://github.com'] },
          },
        }],
      },
    })
    return
  }
  send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32601, message: `method not found: ${message.method}` } })
}

export { ONBOARDING_STEPS, buildPublishArgs, handle, githubStatus, hubResult, listDiscussions, RESOURCE_MIME_TYPE, RESOURCE_REGISTRY, SERVER_VERSION, stageDraft, takeStagedDraft, TOOL_REGISTRY }

const directRun = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
if (directRun) {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      handle(JSON.parse(trimmed)).catch((error) => send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: error.message } }))
    } catch (error) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } })
    }
  })
}
