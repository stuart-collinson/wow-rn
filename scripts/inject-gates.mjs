import { readFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root =
  process.env.CLAUDE_PLUGIN_ROOT ||
  resolve(dirname(fileURLToPath(import.meta.url)), '..');

const readGate = (path) => {
  const full = resolve(root, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : '';
};

const codingStandards = readGate('gates/coding-standards.md');
const projectStructure = readGate('gates/project-structure.md');
const frontendPatterns = readGate('gates/frontend-patterns.md');
const tanstackQuery = readGate('gates/tanstack-query.md');
const backendPatterns = readGate('gates/backend-patterns.md');
const databaseStandards = readGate('gates/database-standards.md');
const securityStandards = readGate('gates/security-standards.md');

const context = `
# React Native Engineering Standards — Active for this session

These rules apply to every response in this session without exception.

## Orchestration
- Coding standards, project structure, and security standards apply to every task.
- App / UI task: coding-standards + project-structure + frontend-patterns + security-standards
- App data-fetching / server-state task: also apply tanstack-query (it owns the data layer — keys, caching, invalidation, hooks dir, prefetch)
- API task: coding-standards + project-structure + backend-patterns + database-standards + security-standards
- Database / migration task: coding-standards + database-standards + security-standards
- Touches multiple areas: apply all gates below
- Heavier security audits can be delegated to the security-reviewer agent.

## Coding Standards (all tasks)
${codingStandards}

## Project Structure (all tasks)
${projectStructure}

## Frontend Patterns (app / UI tasks)
${frontendPatterns}

## TanStack Query — Data Layer (app data-fetching / server-state tasks)
${tanstackQuery}

## Backend Patterns (API tasks)
${backendPatterns}

## Database Standards (data / migration tasks)
${databaseStandards}

## Security Standards (all tasks)
${securityStandards}
`;

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: context,
  },
}));
