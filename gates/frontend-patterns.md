# Frontend Patterns

Patterns for the app stack: **Expo (SDK 54+) + Expo Router + React Native + TypeScript + gluestack-ui v3 + NativeWind + Zustand + React Hook Form + Zod + TanStack Query.** No browser DOM — there is no `div`, no `onClick`, no `className`-on-everything-for-free. Components come from `react-native` and `@/components/ui` (gluestack), styling is NativeWind `className`, navigation is Expo Router.

## Components

### Reuse before build

Before writing a new component, search for one that does the job. Order of preference: a **gluestack-ui primitive** (`Box`, `VStack`, `HStack`, `Button`, `Input`, `Modal`, `Pressable` — most of what a screen needs is already there) → an existing component in `src/components/` → a composition of those → only then build new. Same for hooks and utilities. Bespoke components are a liability — justify why an existing piece won't work first.

### One component per file

Every component file defines exactly one component. Sub-components get their own file inside a folder named after the parent (see `project-structure`). The parent owns data, state, and handlers; sub-components are pure rendering of a single concern.

```tsx
// PASS — WorkoutList/WorkoutList.tsx owns logic, composes children
const WorkoutList = () => {
  const { data: workouts, isLoading, error, refetch } = useWorkouts()

  if (isLoading) return <WorkoutListSkeleton />
  if (error) return <ErrorState message="Couldn't load workouts" onRetry={refetch} />
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

## Styling — NativeWind

Styling is Tailwind utility classes via `className`, processed at build time by NativeWind. This is the default for all layout and visual styling — reach for `StyleSheet.create` only for the rare dynamic value Tailwind can't express, and never inline a `style={{ ... }}` object literal for something a utility class covers.

```tsx
// PASS — NativeWind className on RN / gluestack components
import { Box } from '@/components/ui/box'
import { VStack } from '@/components/ui/vstack'
import { Text } from '@/components/ui/text'

const StatCard = ({ label, value }: Props) => (
  <Box className="rounded-xl bg-background-50 p-4">
    <VStack className="gap-1">
      <Text className="text-sm text-typography-500">{label}</Text>
      <Text className="text-2xl font-bold text-typography-900">{value}</Text>
    </VStack>
  </Box>
)

// FAIL — inline style object for what a utility class covers
<View style={{ borderRadius: 12, padding: 16 }} />
```

- **Design tokens are Tailwind theme values**, not magic numbers. Spacing, colour, and radius come from `tailwind.config.js`; reference the semantic token (`bg-background-50`, `text-typography-900`) so a theme change is one edit. gluestack-ui ships a token palette — extend it, don't bypass it with raw hex.
- **Dark mode** uses NativeWind's `dark:` variant and is driven by `colorScheme`. Set `userInterfaceStyle: "automatic"` in `app.json` so the app follows the system by default; toggle manually with `colorScheme.set(...)` when the user overrides.
- **Always wrap screens in `SafeAreaView`** (from `react-native-safe-area-context`) so content clears notches and home indicators.

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

### Auth gate — `Stack.Protected` in the root layout

The signed-in/signed-out split is enforced declaratively in the root `_layout.tsx` with `Stack.Protected` guards, not with scattered redirects in each screen.

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router'
import { useSession } from '@/hooks/useSession'

const RootLayout = () => {
  const { isAuthenticated, isLoading } = useSession()

  if (isLoading) return <SplashScreen />

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

export default RootLayout
```

## State Management

Pick the smallest tool that fits.

| State type | Tool |
|---|---|
| Server state / cache | TanStack Query |
| Form state | React Hook Form (single instance, even across wizard steps) |
| Shared / cross-component / persistent client state | Zustand |
| App-lifetime cross-cutting (session, theme) | React Context |
| Local state machine — 3+ related values that transition together | `useReducer` |
| Single-component UI state (toggle, open/closed) | `useState` |

### Server state — TanStack Query

All data from the API or Supabase is server state and lives in the TanStack Query cache. **Never mirror query data into Zustand** — that creates two sources of truth that drift. Wrap each resource in a typed hook so screens stay declarative.

```tsx
// hooks/useWorkouts.ts
const useWorkouts = () =>
  useQuery({ queryKey: ['workouts'], queryFn: () => api.workouts.list() })

// Mutation with cache invalidation
const useCreateWorkout = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.workouts.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workouts'] }),
  })
}
```

Query keys are arrays, structured most-general → most-specific (`['workouts']`, `['workouts', id]`) so invalidation can target a subtree. React Native needs two bits of wiring at the `QueryClientProvider`, done once in a provider:

```tsx
// Refetch when the app returns to the foreground
import { focusManager, onlineManager } from '@tanstack/react-query'
import { AppState, Platform } from 'react-native'
import NetInfo from '@react-native-community/netinfo'

AppState.addEventListener('change', (status) => {
  if (Platform.OS !== 'web') focusManager.setFocused(status === 'active')
})
onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) => setOnline(!!state.isConnected)))
```

### Zustand for shared client state

Preferred for shared, cross-component, or persistent client state — filters, selections, UI flags. Not for form state, not for server data. Consumers always use a selector; never destructure the whole store (it re-renders on every change).

```tsx
const selectedId = useWorkoutStore((state) => state.selectedId)  // PASS
const { selectedId } = useWorkoutStore()                          // FAIL — re-renders on every change
```

For persistence across app launches, use Zustand's `persist` middleware with an AsyncStorage adapter (or SecureStore for anything sensitive — see `security-standards`).

### `useReducer` for local state machines

Reach for `useReducer` when a component has **3+ related state values that transition together**, or models something as `idle | loading | success | error`. Use a flat state object with a `status` field and a discriminated-union action so the `switch` is exhaustive. Keep it co-located; extract to a hook if it grows past ~50 lines. Don't mirror local state-machine state into Zustand.

## Forms — React Hook Form + Zod

RHF is the single source of truth for form state. Never use Zustand or `useState` for form fields. Zod handles validation via `zodResolver`. Because RN inputs are controlled differently from web, use `Controller` to bind gluestack inputs.

```tsx
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

const SignInForm = () => {
  const { control, handleSubmit, formState: { errors, isSubmitting } } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
  })

  const onSubmit = async (data: SignInInput) => { await signIn(data) }

  return (
    <VStack className="gap-4">
      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <Input>
            <InputField placeholder="Email" autoCapitalize="none" keyboardType="email-address"
              value={value} onChangeText={onChange} onBlur={onBlur} />
          </Input>
        )}
      />
      {errors.email && <Text className="text-error-600">{errors.email.message}</Text>}
      <Button onPress={handleSubmit(onSubmit)} isDisabled={isSubmitting}>
        <ButtonText>Sign in</ButtonText>
      </Button>
    </VStack>
  )
}

export default SignInForm
```

Multi-step wizards use a **single RHF instance at the parent**, shared via `FormProvider` / `useFormContext` — never a separate `useForm` per step.

## Loading, Empty, and Error States

Every screen that loads data handles three states explicitly: **loading, empty, error** — never just the happy path. Drive them off the query object (`isLoading`, `error`, empty `data`) in that priority order (see `WorkoutList` above). Skeletons live next to the component they shadow, match its shape, and shimmer with NativeWind's `animate-pulse`. Mutations follow the same shape: pending (disable the submit, show an indicator off `mutation.isPending`), success (toast / navigate), error (inline near the field, or a toast).

## Optimistic UI

For mutations where the post-mutation state is predictable (toggling a favourite, renaming), use TanStack Query's optimistic pattern — it owns the cache, so the optimistic value and the eventual server value live in one place.

```tsx
const toggleFavourite = useMutation({
  mutationFn: api.workouts.toggleFavourite,
  onMutate: async ({ id, favourited }) => {
    await queryClient.cancelQueries({ queryKey: ['workouts'] })
    const previous = queryClient.getQueryData<Workout[]>(['workouts'])
    queryClient.setQueryData<Workout[]>(['workouts'], (old) =>
      old?.map((workout) => (workout.id === id ? { ...workout, favourited } : workout)),
    )
    return { previous }
  },
  onError: (_err, _input, context) => {
    if (context?.previous) queryClient.setQueryData(['workouts'], context.previous)
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['workouts'] }),
})
```

Don't optimistically update destructive mutations (delete, archive) where a revert would jar, or where the server result isn't predictable — show a normal pending state there.

## Lists — `FlatList`, not `.map`

Long or unbounded lists use `FlatList` (or `FlashList`), never `data.map()` inside a `ScrollView` — mapping renders every row up front and tanks performance and memory on real lists. Always provide a stable `keyExtractor` (the row's `id`, never the index). For very long lists prefer `@shopify/flash-list`. Memoise the `renderItem` row component with `React.memo` when rows are non-trivial.

## Performance

Optimise when you measure a problem. `useMemo` / `useCallback` cost something — reach for them when a measured re-render is the problem or a value flows into a memoised child. Wrap list-row components in `React.memo`. Use `expo-image` (not RN `Image`) for caching and better memory behaviour. Defer heavy work off the JS thread where the API allows (reanimated worklets for animation).

## Accessibility

- Every interactive element has an accessible label — `accessibilityLabel`, or visible text inside it.
- Interactive elements declare `accessibilityRole` (`button`, `link`, `header`).
- Touch targets are at least 44×44pt.
- Colour is never the only signal — pair it with text, an icon, or a state.
- Respect the reduce-motion setting for animations.

## Environment Variables

Expo exposes only variables prefixed `EXPO_PUBLIC_` to the app bundle. Everything `EXPO_PUBLIC_*` ships to the device and is readable by anyone with the app — **it is not a secret**. Centralise access in one validated module; components never read `process.env` directly.

```typescript
// lib/env.ts — the single place that reads process.env, validated with Zod
import { z } from 'zod'

const envSchema = z.object({
  EXPO_PUBLIC_SUPABASE_URL: z.string().url(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  EXPO_PUBLIC_API_URL: z.string().url(),
})

export const env = envSchema.parse({
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
})
```

A missing or malformed var then fails fast at startup. Never put a server secret (service-role key, API signing key) in an `EXPO_PUBLIC_*` var — those live only on the API (see `backend-patterns`).
