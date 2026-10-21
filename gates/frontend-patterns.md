# Frontend Patterns

Patterns for the app stack: **Expo (current stable SDK) + Expo Router + React Native + TypeScript + React Native Reusables + Uniwind (Tailwind v4) + Expo UI + Zustand + React Hook Form + Zod + TanStack Query.** No browser DOM — there is no `div`, no `onClick`, no `className`-on-everything-for-free. Components come from `react-native`, `@/components/ui` (Reusables) and `@expo/ui` (native controls), styling is Uniwind `className`, navigation is Expo Router.

## Components

### Reuse before build

Before writing a new component, search for one that does the job. Order of preference: an **Expo UI native control** when the platform already draws it (switches, pickers, date pickers, context menus, bottom sheets) → a **Reusables component** in `@/components/ui` (`Button`, `Text`, `Input`, `Card`, `Dialog`, `Select` — add a missing one with the Reusables CLI) → an existing component in `src/components/` → a composition of those → only then build new. Same for hooks and utilities. Bespoke components are a liability — justify why an existing piece won't work first.

### One component per file

Every component file defines exactly one component. Sub-components get their own file in the parent's folder (see `project-structure`). The parent owns data, state, and handlers; sub-components are pure rendering of a single concern.

```tsx
// PASS — components/Workout/WorkoutList.tsx owns logic, composes children
const WorkoutList = () => {
  const { data, isPending, refetch } = useWorkouts()

  if (isPending) return <WorkoutListSkeleton />
  if (!data) return <ErrorState message="Couldn't load workouts" onRetry={refetch} />

  const workouts = data.pages.flatMap((page) => page.data)
  if (workouts.length === 0) return <EmptyState message="No workouts yet" />

  return (
    <FlatList
      data={workouts}
      keyExtractor={(workout) => workout.id}
      renderItem={({ item }) => <WorkoutRow workout={item} />}
    />
  )
}

export default WorkoutList
```

### No god components

10+ props or orchestrating five concerns means split it. Use stores or context for cross-cutting state instead of forwarding everything via props. Three or more levels of pass-through prop drilling is the threshold — at that point the leaf reads from a Zustand store directly.

## Styling — Uniwind

Styling is Tailwind v4 utility classes via `className`, compiled at build time by Uniwind (a Metro plugin, no Babel preset; `global.css` imports `tailwindcss` and `uniwind`). This is the default for all layout and visual styling — reach for `StyleSheet.create` only for the rare dynamic value Tailwind can't express, and never inline a `style={{ ... }}` object literal for something a utility class covers. React Native's own components take `className` directly; a third-party component is wrapped once, at module level, with `withUniwind` (`expo-image`'s `Image`, for instance) — never a `react-native` or Reanimated component, which already support it.

```tsx
// PASS — Uniwind className on RN views and Reusables components
import { View } from 'react-native'
import { Text } from '@/components/ui/text'

const StatCard = ({ label, value }: Props) => (
  <View className="gap-1 rounded-xl bg-card p-4">
    <Text className="text-sm text-muted-foreground">{label}</Text>
    <Text className="text-2xl font-bold text-foreground">{value}</Text>
  </View>
)

// FAIL — inline style object for what a utility class covers
<View style={{ borderRadius: 12, padding: 16 }} />
```

- **Design tokens are Tailwind theme values**, not magic numbers. Colours and radii are the `--color-*` and `--radius` variables in `global.css` (the shadcn set Reusables expects: `background`, `foreground`, `card`, `primary`, `muted`, `border`, `destructive`, …); reference the semantic class (`bg-card`, `text-muted-foreground`) so re-theming an app is one CSS edit. Never a raw hex value in a component.
- **Dark mode is automatic.** The `@variant light` / `@variant dark` blocks in `global.css` swap the variables, so a component never writes `dark:` for a themed colour. Set `userInterfaceStyle: "automatic"` in `app.json` so the app follows the system (Android also needs `expo-system-ui` installed); override with `Uniwind.setTheme('dark' | 'light' | 'system')` when the user chooses.
- **Screens respect the safe area.** Native stack headers and native tabs already inset their content; a header-less screen wraps its content in `SafeAreaView` from `react-native-safe-area-context`.

### Expo UI versus Tailwind

Native chrome and controls come from Expo Router (tabs, headers, toolbars) and **Expo UI** (`@expo/ui`: SwiftUI on iOS, Jetpack Compose on Android). An Expo UI component is styled by its own props, follows the system theme, renders inside a `Host`, and never takes `className` or `withUniwind`. Everything else — the content where the brand lives — is React Native views and Reusables styled with Tailwind. Where Expo UI lacks a control, Reusables is the fallback; never a third library.

```tsx
// PASS — a native switch inside branded content
import { Host, Switch } from '@expo/ui'

<View className="flex-row items-center justify-between rounded-xl bg-card p-4">
  <Text className="text-foreground">Reminders</Text>
  <Host style={{ height: 32 }}>
    <Switch value={enabled} onValueChange={setEnabled} />
  </Host>
</View>
```

## Navigation — Expo Router

Routing is file-based; the `app/` tree is the navigation tree (see `project-structure`). Navigate with `<Link>` for declarative links and `router.push` / `router.replace` for imperative moves. Never hardcode a path string when a typed route is available.

```tsx
import { Link, router, useLocalSearchParams } from 'expo-router'

// Declarative
<Link href={{ pathname: '/workouts/[id]', params: { id: workout.id } }}>Open</Link>

// Imperative
router.push({ pathname: '/workouts/[id]', params: { id: workout.id } })

// Reading a dynamic param inside the [id].tsx screen
const { id } = useLocalSearchParams<{ id: string }>()
```

Enable **typed routes** (`experiments.typedRoutes: true` in `app.json`) so route strings and params are type-checked.

### Tabs — `NativeTabs`

The signed-in tab bar is the platform's own, from `expo-router/native-tabs`, not a JS re-creation: Liquid Glass on iOS 26+, Material on Android, pop-to-root for free. Icons are SF Symbols on iOS and Material symbols on Android, declared per trigger.

```tsx
// app/(tabs)/_layout.tsx
import { NativeTabs } from 'expo-router/native-tabs'

const TabsLayout = () => (
  <NativeTabs>
    <NativeTabs.Trigger name="index">
      <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md={{ default: 'home', selected: 'home_filled' }} />
      <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
    </NativeTabs.Trigger>
    {/* one Trigger per tab route */}
  </NativeTabs>
)

export default TabsLayout
```

Native tabs have no header and no stack of their own. A tab that pushes screens (a list opening a detail) is a folder with its own `_layout.tsx` rendering a `Stack`; without it the tab can't push screens or show a header.

### Auth gate — `Stack.Protected` in `AppShell`

The signed-in/signed-out split is enforced declaratively with `Stack.Protected` guards, not with scattered redirects in each screen. They live in `components/AppShell/AppShell.tsx`, which the root `_layout.tsx` renders inside the providers, because the guards read hooks that need those providers.

```tsx
// src/components/AppShell/AppShell.tsx — rendered by app/_layout.tsx inside the providers
import { useEffect } from 'react'
import { SplashScreen, Stack } from 'expo-router'
import { useSession } from '@/hooks/useSession'

SplashScreen.preventAutoHideAsync()

const AppShell = () => {
  const { isAuthenticated, isLoading } = useSession()

  useEffect(() => {
    if (!isLoading) SplashScreen.hide()
  }, [isLoading])

  if (isLoading) return null

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  )
}

export default AppShell
```

## State Management

Pick the smallest tool that fits.

| State type | Tool |
|---|---|
| Server state / cache | TanStack Query (owned by the `tanstack-query` gate) |
| Form state | React Hook Form (single instance, even across wizard steps) |
| Shared / cross-component / persistent client state | Zustand |
| App-lifetime cross-cutting (session, theme) | React Context |
| Local state machine — 3+ related values that transition together | `useReducer` |
| Single-component UI state (toggle, open/closed) | `useState` |

### Server state — TanStack Query

All data from Supabase is server state, and **the `tanstack-query` gate owns all of it** — the `lib/api/` ↔ `hooks/<domain>/` split, query keys, caching, mutations, persistence and prefetch. Nothing above `lib/` imports the Supabase client, and a server read is a cached `use*` hook, never `useState` + `useEffect`.

### Zustand for shared client state

Preferred for shared, cross-component, or persistent client state — filters, selections, UI flags. Not for form state, not for server data. Consumers always use a selector; never destructure the whole store (it re-renders on every change).

```tsx
const selectedId = useWorkoutStore((state) => state.selectedId)  // PASS
const { selectedId } = useWorkoutStore()                          // FAIL — re-renders on every change
```

For persistence across app launches, use Zustand's `persist` middleware with `createJSONStorage(() => kvStorage)` from `@/lib/storage` (`expo-sqlite/kv-store`). Nothing secret goes in a store — see `security-standards`.

### `useReducer` for local state machines

Reach for `useReducer` when a component has **3+ related state values that transition together**, or models something as `idle | loading | success | error`. Use a flat state object with a `status` field and a discriminated-union action so the `switch` is exhaustive. Keep it co-located; extract to a hook if it grows past ~50 lines. Don't mirror local state-machine state into Zustand.

## Forms — React Hook Form + Zod

RHF is the single source of truth for form state. Never use Zustand or `useState` for form fields. Zod handles validation via `zodResolver`; the schema lives in `src/schemas/` (`workout.schema.ts`) and its inferred type is the form's type. Because RN inputs are controlled differently from web, use `Controller` to bind Reusables inputs.

```tsx
const CreateWorkoutForm = ({ onSubmit }: Props) => {
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(createWorkoutSchema),
    defaultValues: { name: '', durationMinutes: 30 },
  })

  return (
    <View className="gap-4">
      <Controller
        control={control}
        name="name"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input placeholder="Workout name" value={value} onChangeText={onChange} onBlur={onBlur} />
        )}
      />
      {errors.name && <Text className="text-destructive">{errors.name.message}</Text>}
      <Button onPress={handleSubmit(onSubmit)} disabled={isSubmitting}>
        <Text>Save workout</Text>
      </Button>
    </View>
  )
}

export default CreateWorkoutForm
```

Types come from the schema through the resolver. Every schema field has a `defaultValues` entry and a bound input; a required field left unbound fails submit with nothing on screen.

Multi-step wizards use a **single RHF instance at the parent**, shared via `FormProvider` / `useFormContext` — never a separate `useForm` per step.

## Loading, Empty, and Error States

Every screen that loads data handles **loading, error, empty** explicitly, in that order off the query object: `isPending`, then no `data`, then empty `data` (`WorkoutList` above). Test `data`, not `error`: a failed background refetch sets `error` but keeps the cached rows, and they stay on screen. Skeletons sit next to the component they shadow, match its shape, and are built from the Reusables `Skeleton`. Mutations do the same: pending off `mutation.isPending` (submit disabled), success (toast / navigate), error (inline or toast). Optimistic updates are opt-in and owned by `tanstack-query` §8.

## Lists — `FlatList`, not `.map`

Long or unbounded lists use `FlatList`, or `@shopify/flash-list` v2 for very long ones, never `data.map()` inside a `ScrollView` — mapping renders every row up front and tanks performance and memory on real lists. Always provide a stable `keyExtractor` (the row's `id`, never the index). Rows are plain components; the compiler memoises them.

## Performance

Optimise when you measure a problem. The React Compiler is on (`experiments.reactCompiler` in `app.json`), so don't hand-write memoisation — no memo hooks or memo wrappers unless a profiler shows the compiler missed something, and then say why in a comment. Use `expo-image` (not RN `Image`) for caching and better memory behaviour. Defer heavy work off the JS thread where the API allows (Reanimated 4 worklets for animation).

## Adaptive Layouts — iPad

Every app ships with `ios.supportsTablet: true`, so every screen must earn its width. Uniwind's responsive variants are mobile-first: unprefixed classes apply everywhere, `md:` (768pt and up) is the tablet breakpoint, `lg:` (1024pt) landscape tablets. A list-detail screen goes side by side at `md:`, a form caps its width, a grid gains a column. Never a hard-coded width check in a component; a layout that needs the number reads `src/constants/breakpoints.ts`.

```tsx
// PASS — one column on a phone, two on an iPad; a form that doesn't stretch across a 13-inch screen
<View className="w-full p-2 md:w-1/2"><WorkoutCard workout={workout} /></View>
<View className="w-full self-center md:max-w-xl">…</View>
```

## Accessibility

- Every interactive element has an accessible label — `accessibilityLabel`, or visible text inside it.
- Interactive elements declare `accessibilityRole` (`button`, `link`, `header`).
- Touch targets are at least 44×44pt.
- Colour is never the only signal — pair it with text, an icon, or a state.
- Respect the reduce-motion setting for animations.

## Environment Variables

Expo exposes only `EXPO_PUBLIC_*` variables to the bundle, and every one of them is public (`security-standards`). Centralise access in one validated module; components never read `process.env` directly.

```typescript
// lib/env.ts — the single place that reads process.env, validated with Zod
import { z } from 'zod'

const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.url(),
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
})

export const env = envSchema.parse({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
})
```

A missing or malformed var then fails fast at startup.
