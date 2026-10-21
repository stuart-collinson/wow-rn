import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const PLUGIN = 'rn-ways-of-working';
const ENTRY = 'GATES.md';
const IMPORT_LINE = `@~/.claude/plugins/marketplaces/${PLUGIN}/gates/${ENTRY}`;

// InstructionsLoaded can still be settling when the first prompt arrives — a
// headless run submits immediately — so a missing marker is re-checked for a
// moment before warning.
const MARKER_WAIT_MS = 2_000;
const MARKER_POLL_MS = 100;

const root =
  process.env.CLAUDE_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const markerDir = join(tmpdir(), PLUGIN);
const event = JSON.parse(readFileSync(0, 'utf8'));
const marker = (kind) => join(markerDir, `${event.session_id ?? 'unknown'}.${kind}`);

const writeMarker = (kind) => {
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(marker(kind), '');
};

// Only this plugin's GATES.md counts: other plugins ship a gates/GATES.md too.
const isOurGates = (file) => {
  if (!file || basename(file) !== ENTRY) return false;
  const manifest = resolve(dirname(file), '..', '.claude-plugin', 'plugin.json');
  return existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === PLUGIN;
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const gatesLoaded = async () => {
  for (let waited = 0; waited < MARKER_WAIT_MS; waited += MARKER_POLL_MS) {
    if (existsSync(marker('loaded'))) return true;
    await sleep(MARKER_POLL_MS);
  }
  return existsSync(marker('loaded'));
};

const userMessage = `
${PLUGIN}: the engineering gates did NOT load in this session.
Usually "Allow external CLAUDE.md file imports?" was answered No (the default), or this is a headless run in a repo that never answered Yes.
Fix: quit Claude Code, set "hasClaudeMdExternalIncludesApproved": true for this repo under "projects" in ~/.claude.json, and start again.
If CLAUDE.md has no import line, add: ${IMPORT_LINE}
`.trim();

const modelContext = `
WARNING — the ${PLUGIN} gates did not load: the GATES.md import in CLAUDE.md was not expanded.
Tell the user, and until it is fixed Read each gate you need from ${join(root, 'gates')} (ROUTING.md says which) before writing any code.
`.trim();

if (event.hook_event_name === 'InstructionsLoaded' && isOurGates(event.file_path)) writeMarker('loaded');

if (event.hook_event_name === 'UserPromptSubmit' && !existsSync(marker('warned')) && !(await gatesLoaded())) {
  writeMarker('warned');
  console.log(
    JSON.stringify({
      systemMessage: userMessage,
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: modelContext },
    }),
  );
}
