# Coding Standards & Best Practices

Universal coding standards for React Native (Expo) + TypeScript projects. The principles are language-agnostic; examples are TypeScript because that's the stack. Anything tied to React Native, Expo Router, or a specific layer lives in `frontend-patterns.md`, `backend-patterns.md`, or `database-standards.md`, not here.

## Core Principles

These four override every specific rule below. When a guideline conflicts with one of them, the principle wins.

### Readability First

Code is read far more often than it is written. Optimise for the next person — often you, in six months — understanding it at a glance. Clear names and obvious structure beat clever one-liners. If a reader has to stop and puzzle out what a piece of code does, the code is wrong, not the reader.

### KISS — Keep It Simple

The simplest solution that solves the actual problem is almost always the right one. Don't reach for advanced patterns or layers of abstraction when a straightforward approach works. Complexity must justify itself; simplicity is the default.

### DRY — Don't Repeat Yourself

The smell is duplication of *meaning*, not of characters. If two places encode the same rule and must change together, extract it. If two places merely look similar today but represent different concepts that may evolve apart, leave them. Premature DRY creates more friction than it removes.

### YAGNI — You Aren't Gonna Need It

Build only what the current task requires. No speculative features, no "we might need this later" hooks, no config knobs for cases that haven't appeared. Every parameter, branch, and abstraction is something the next reader must understand. Design for a future need *when its real shape is known*.

## Naming Conventions

```typescript
// Variables — camelCase
const activeWorkoutId = 'abc'
const isAuthenticated = true

// Functions — camelCase arrow functions, verb-led
const fetchWorkout = async (workoutId: string): Promise<Workout> => { }
const isValidEmail = (email: string): boolean => { }

// Components — PascalCase
const WorkoutCard = ({ workout }: Props) => { }

// Hooks — camelCase, must start with `use`
const useWorkoutFilters = () => { }

// Constants — SCREAMING_SNAKE_CASE
const MAX_RETRIES = 3
const SYNC_INTERVAL_MS = 30_000

// Types — PascalCase
type Workout = { id: string; name: string }

// Booleans read as questions: isReady, hasPermission, canEdit, shouldRetry
```

Don't encode the type in the name (`userArray`, `strName`) — the type system already conveys it. `users`, not `userArray`.

### Callback parameters and selectors are never single letters

```typescript
// PASS
workouts.filter((workout) => workout.isActive)
useWorkoutStore((state) => state.selectedId)

// FAIL
workouts.filter((w) => w.isActive)
useWorkoutStore((s) => s.selectedId)
```

Absolute rule for parameters you name. Library APIs that mandate a name (Zustand's `set`/`get`) are API surface, not shortcuts.

## TypeScript

### Always use `type`, not `interface`

```typescript
// PASS
type Workout = {
  id: string
  name: string
  status: 'draft' | 'active' | 'archived'
}

// FAIL — only acceptable when a class `implements` it or declaration merging is genuinely required
interface Workout { id: string }
```

### No `any`, no `@ts-ignore`

```typescript
// FAIL
const getWorkout = (id: any): Promise<any> => { }
// @ts-ignore
const result = riskyOperation()

// PASS — explicit types; `unknown` is the escape valve for genuinely-unknown input
const getWorkout = (id: string): Promise<Workout> => { }
const handle = (input: unknown): Result => {
  const parsed = inputSchema.parse(input)
  return process(parsed)
}
```

`unknown` forces narrowing before use — that's the point. `any` switches type-checking off and is never the answer. Run with `strict: true`.

### Explicit return types — but only when they document something

Annotate the return type when it tells the reader something the body doesn't make obvious — a hook's shape, a utility's value, a non-trivial union. Skip `: void`, `: Promise<void>`, `: React.JSX.Element`; they restate the obvious and add noise.

```typescript
// PASS — annotation documents the value
const formatDuration = (seconds: number): string => `${Math.round(seconds / 60)}m`
const useWorkouts = (): { workouts: Workout[]; isLoading: boolean } => { }

// PASS — nothing to document, no annotation
const WorkoutCard = ({ workout }: Props) => <Text>{workout.name}</Text>
const handlePress = () => setOpen(true)
```

## Functions — arrow functions always

```typescript
// PASS
const fetchData = async (url: string): Promise<unknown> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.json()
}

// FAIL — function keyword
function fetchData(url: string) { }
export default function Screen() { }  // use an arrow function assigned to a const
```

Exception: methods inside a `class` use method syntax (relevant on the backend; classes are rare in the app).

## Control Flow — guard clauses

Reverse conditions and exit early. Strip braces from one-line branches.

```typescript
// PASS
if (!user) return null
if (isLoading) return <LoadingState />

// PASS — multi-line still needs braces
if (!user) {
  logMissingUser()
  return null
}
```

Three or more levels of nesting is the smell — flatten with guards.

## Immutability

Treat all data as immutable. Build new values; never mutate inputs.

```typescript
// PASS
const updated = { ...workout, name: 'New Name' }
const appended = [...items, newItem]
const sorted = [...workouts].sort((first, second) => second.volume - first.volume)

// FAIL — mutation
workout.name = 'New Name'
items.push(newItem)
workouts.sort(...)   // sorts in place — dangerous when it's React state or a prop
```

This matters most with React state, props, or Zustand values — mutation skips React's change detection and produces ghost bugs.

## Async / Await

Run independent calls in parallel.

```typescript
// PASS
const [user, workouts, stats] = await Promise.all([fetchUser(), fetchWorkouts(), fetchStats()])

// FAIL — serial when nothing depends on the previous result
const user = await fetchUser()
const workouts = await fetchWorkouts()
```

Sequential `await` is correct only when each call genuinely depends on the previous one. Reach for `Promise.allSettled` when partial failure should still let the rest proceed.

## File Structure (within a file)

Every file reads top to bottom: **imports → types → constants → logic → render**. All type declarations are grouped immediately after imports, before any logic — never scattered through the file.

```typescript
// 1. IMPORTS   2. TYPES (all together)   3. CONSTANTS   4. LOGIC   5. RENDER (primary export)
```

## Visibility & Scoping

Pick the smallest scope that works. The two failure modes below are the most common gate violations.

### Don't export what isn't used externally

If a type, constant, function, or component is only used in the file that defines it, **do not `export` it**. Every `export` is a contract with the rest of the codebase — dead surface area that confuses readers and blocks refactors. When something becomes used in a second file, *then* export it.

### Don't keep shared things inline

The moment a type, constant, or helper is needed in a *second* file, extract it to its proper home — never duplicate, and never leave it exported from a screen/component file when its real home is a shared module. A thing used by N≥2 files lives somewhere both can import from cleanly, not in one of the consumers.

Together: **`export` should be rare and intentional.**

## Magic Values → Named Constants

Any literal whose meaning isn't obvious from its position should be a named constant. Common candidates: timeouts, delays, retry counts, page sizes, max lengths, status strings used in comparisons, URLs, storage keys.

```typescript
// FAIL
setTimeout(callback, 500)
if (retryCount > 3) { }

// PASS — name captures intent, not value
const DEBOUNCE_DELAY_MS = 500
const MAX_RETRIES = 3
```

Name for **intent** rather than value: `MAX_UPLOAD_BYTES`, not `FIVE_MB`.

## Comments — few, load-bearing

A good codebase has few comments, and the ones it has are load-bearing. Most comments are the trace of a missing abstraction, an unclear name, or a too-long function — fix the code, not the prose. The exception is genuinely complex, subtle, or critical code: there a comment explaining the *why* is exactly what a future reader needs.

The bar: *would a careful reader miss this without the comment?* If yes, write it. Cases that meet the bar — a non-trivial invariant the type system can't enforce; the reasoning behind subtle/critical code; a workaround for an external bug (with a link); a deliberate rejection of an obvious alternative.

Delete-on-sight: comments that restate what the code does, section-label comments (extract a named function instead), commented-out code, unowned `TODO`s, boilerplate JSDoc that restates the signature.

## Whitespace

One blank line between type declarations, between functions, and between logical blocks within a function. Never two blank lines in a row. No trailing whitespace; no trailing blank lines at end of file. Whitespace is structure — use it deliberately.

## No Unused Code

The codebase contains only code currently in use: no unused imports, variables, parameters, functions, or exports; no commented-out code; no unreachable branches; no "just in case" hooks. If it isn't reached, delete it. Linters enforce this; CI fails when they don't.

## Error Handling

- **Fail loudly at boundaries.** Never silently swallow an error you don't understand. An empty `catch` is almost always a bug.
- **Handle or propagate.** Catch only when you can do something meaningful — recover, retry, fall back. Otherwise let it bubble to a layer that can.
- **Don't use exceptions for ordinary control flow.** Errors are for unexpected conditions, not routine "this doesn't exist" cases.
- **Error messages are read by humans.** Include what was attempted, the input involved, what the system expected.
- **Validate at trust boundaries** — user input, external APIs, deep-link params, route payloads. Trust internal calls.

## Input Validation — Zod

Every external input — anything from the user, a deep link, or the network — is validated with Zod before use. Inferred types come from the schema, not declared separately.

```typescript
const createWorkoutSchema = z.object({
  name: z.string().min(1).max(200),
  durationMinutes: z.number().int().positive(),
})

type CreateWorkoutInput = z.infer<typeof createWorkoutSchema>

// Non-throwing flow for user input
const result = createWorkoutSchema.safeParse(input)
if (!result.success) return showErrors(result.error.flatten())
await createWorkout(result.data)
```

## Testing — AAA and descriptive names

Tests follow **Arrange / Act / Assert**, visually separated. Test names describe the behaviour and the conditions under which it holds — not the function being tested. A failing test name should tell the on-call engineer what broke without opening the file.

```typescript
// PASS — describes behaviour and condition
test('returns empty array when no workouts match the query', () => {
  const input = 'nonexistent'
  const result = filterWorkouts(allWorkouts, input)
  expect(result).toEqual([])
})

// FAIL — vague
test('works', () => { })
```

## When Rules Conflict

Fall back to **Readability First** — pick the version a future reader understands fastest.
