import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const PLUGIN = 'rn-ways-of-working';
const ENTRY = 'GATES.md';
const IMPORT_LINE = `@~/.claude/plugins/marketplaces/${PLUGIN}/gates/${ENTRY}`;

// Claude Code caps a hook's additionalContext at this many characters. Anything
// larger is swapped for a file path and a 2 KB preview, with no error — which is
// why gate text travels through the CLAUDE.md import and never through here.
const HOST_CONTEXT_CHAR_CAP = 10_000;

// The project memory files Claude Code loads, in the order it loads them.
const MEMORY_FILES = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];

const root =
  process.env.CLAUDE_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const gateRoot = join(root, 'gates');

const IMPORT_PATTERN = new RegExp(`^[ \\t]*(?:[-*+][ \\t]+)?@(\\S*/${PLUGIN}/gates/${ENTRY})[ \\t]*$`, 'm');
const FENCED_BLOCK = /```[\s\S]*?```/g;

const expandHome = (path) => (path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);

// Claude Code ignores imports inside fenced code blocks, so strip them before
// matching — a README-style example must not count as a live import.
const findImport = () => {
  for (const file of MEMORY_FILES.map((name) => join(project, name)).filter(existsSync)) {
    const match = readFileSync(file, 'utf8').replace(FENCED_BLOCK, '').match(IMPORT_PATTERN);
    if (match) return { file, target: resolve(dirname(file), expandHome(match[1])) };
  }
  return null;
};

const describeProblem = (found) => {
  if (!found) return `No memory file in ${project} (${MEMORY_FILES.join(', ')}) imports ${ENTRY}`;
  if (!existsSync(found.target)) {
    return `${found.file} imports ${found.target}, which does not exist (is the plugin installed from its marketplace?)`;
  }
  return null;
};

const readVersion = (pluginRoot) => {
  const manifest = join(pluginRoot, '.claude-plugin', 'plugin.json');
  return existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).version : null;
};

// The gates are read from the marketplace copy, which auto-update refreshes on
// every pass; skills and hooks come from the versioned plugin cache, which only
// moves when the version changes. The two can drift apart.
const versionDrift = (found) => {
  const gatesVersion = readVersion(resolve(dirname(found.target), '..'));
  const pluginVersion = readVersion(root);
  if (!gatesVersion || !pluginVersion || gatesVersion === pluginVersion) return '';
  return `

Version mismatch: the gates are v${gatesVersion} but this plugin's skills and hooks
are v${pluginVersion}. Run \`claude plugin marketplace update ${PLUGIN} && claude plugin
update ${PLUGIN}@${PLUGIN}\`, then start a new session.`;
};

const present = (found) =>
  `
# React Native engineering standards — ${PLUGIN}

${found.file} imports the gates. Claude Code expands that import only if external
imports were approved for this project; a check on the first prompt warns if they
did not load. They are rules, not suggestions. Where this repo's own CLAUDE.md and
a gate overlap, the repo wins; flag any conflict rather than silently picking a side.${versionDrift(found)}
`.trim();

const warning = (problem) =>
  `
# WARNING — ${PLUGIN} gates: import line not found

${problem}. If the repo imports the gates some other way, the first-prompt check
confirms it; otherwise no gate text is in this session. A hook cannot carry it:
Claude Code caps hook context at ${HOST_CONTEXT_CHAR_CAP} characters and the gates are far larger.

Fix: add this line, on its own, to this repo's CLAUDE.md, then start a new session:

${IMPORT_LINE}

If the gate text isn't in your context, Read each gate you need from ${gateRoot}
before writing any code.

${readFileSync(join(gateRoot, 'ROUTING.md'), 'utf8').trim()}
`.trim();

const found = findImport();
const problem = describeProblem(found);
const context = problem ? warning(problem) : present(found);

if (context.length > HOST_CONTEXT_CHAR_CAP) {
  throw new Error(
    `check-gates: ${context.length} chars exceeds the ${HOST_CONTEXT_CHAR_CAP}-char hook ` +
      `context cap — the host would silently truncate it.`,
  );
}

console.log(
  JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
  }),
);
