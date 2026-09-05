// Shared by recognition and render orchestration; image_gen selects its own image model.
export const CODEX_MODEL = 'gpt-6-astra'
export const CODEX_REASONING_EFFORT = 'high'
// Dense pixel tracing is bounded by the interactive recognition timeout; verify geometry, not effort labels.
export const PLAN_REASONING_EFFORT = 'medium'
export const MODEL_LABEL = 'GPT-6 Astra · image_gen'

export const MIN_CODEX_VERSION = '0.153.1'

/** Accept the CLI's `codex-cli x.y.z` output; unknown versions are not supported. */
export function supportsCodexModel(output) {
  const version = /\b(\d+)\.(\d+)\.(\d+)\b/.exec(output)?.slice(1).map(Number)
  if (!version) return false
  const minimum = MIN_CODEX_VERSION.split('.').map(Number)
  for (let i = 0; i < minimum.length; i++) {
    if (version[i] !== minimum[i]) return version[i] > minimum[i]
  }
  return true
}
