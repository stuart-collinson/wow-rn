# Store & Monetisation

What it takes to be on both stores and make money at no monthly cost. Payments, ads and push are **optional modules**: a section marked *(when enabled)* applies only to an app that turned that module on when it was scaffolded; an app without it must still pass every other rule here.

## Payments — RevenueCat *(when enabled)*

- **Configure once the session exists** in `lib/purchases.ts`: `configurePurchases(userId)` calls `Purchases.configure({ apiKey, appUserID: userId })` with the platform's public SDK key from `env` (`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`), so a purchase never sits on an anonymous RevenueCat id and entitlements follow the Supabase user across devices. A later user switch is `Purchases.logIn(userId)`; `Purchases.logOut()` runs in sign-out (`tanstack-query` §2a).
- **`useEntitlements()`** (`hooks/useEntitlements.ts`) is the only place the app reads purchase state: `getCustomerInfo()` on mount plus `addCustomerInfoUpdateListener`, returning `{ isPro, isLoading }` where `isPro = Boolean(customerInfo.entitlements.active['pro'])`. The RevenueCat SDK is the cache — this is not a TanStack query, and `isPro` is never mirrored into Zustand.
- **The paywall is RevenueCat's.** Gate an action with `RevenueCatUI.presentPaywallIfNeeded({ requiredEntitlementIdentifier: 'pro' })`; the paywall itself is designed in the RevenueCat dashboard and changes without a release. Its footer links Apple's standard Terms of Use (`https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`) and the app's privacy page, and the App Store description carries both links; guideline 3.1.2 rejects a subscription without them.
- **Restore purchases is always visible** — on the paywall and in settings — calling `Purchases.restorePurchases()`. Apple rejects apps without it.
- **No server by default.** When a server-side decision needs the plan, the `revenuecat-webhook` Edge Function (`edge-functions`) calls `apply_entitlement_event()` (`SECURITY DEFINER`, `EXECUTE` for `service_role` only, or any user could grant themselves the plan), which upserts the user's `entitlement` row (`user_id`, `entitlement`, `expires_at`, `event_at`; primary key `(user_id, entitlement)`) and ignores an event older than the row's `event_at`. The table is SELECT-own with no write policies (`database-standards` → RLS); policies and RPCs check `public.has_entitlement('pro')`, a `STABLE SECURITY DEFINER` function true while the caller's row has `expires_at > now()`. The client's `isPro` is UX only.
- Needs a development build (native module); no config plugin. Free until $2,500 a month of tracked revenue, then 1%.

## Ads — AdMob *(when enabled)*

- **`initialiseAds()`** (`lib/ads.ts`) is the one entry point, in this order: `AdsConsent.gatherConsent()` → if `canRequestAds`, on iOS `requestTrackingPermissionsAsync()` from `expo-tracking-transparency` only when GDPR does not apply or purpose-one consent was given → `mobileAds().initialize()`. It resolves `true` when ads may be requested and is awaited once from the root layout.
- **`AdBanner`** (`components/AdBanner/AdBanner.tsx`) is the **only** component that renders an ad. It returns `null` unless all of these hold: `useAppConfig().data?.ads_enabled === true`, `initialiseAds()` resolved `true`, and, when payments are enabled, the user is not `isPro`. Unit id is `__DEV__ ? TestIds.ADAPTIVE_BANNER : AD_UNIT_IDS.banner[Platform.OS]` from `constants/ads.ts`; size `BannerAdSize.ANCHORED_ADAPTIVE_BANNER`; reload on iOS foreground with `useForeground`.
- **The kill switch is the database.** Flip `ads_enabled` in the Supabase dashboard table editor and every install drops its ads within the config stale time or at next launch. No release, no env var.
- `app.json` plugin config carries `androidAppId`, `iosAppId`, `userTrackingUsageDescription` and `delayAppMeasurementInit: true`. The library needs a development build and the New Architecture; its Android port is still partial — check its README status table before enabling ads on Android.
- Never an interstitial on launch, never an ad on the sign-in or paywall screens.

## Push *(when enabled)*

- **`registerForPush()`** (`lib/notifications.ts`) asks permission at a meaningful moment — right after the user does the thing notifications are about — never on first launch. On grant it calls `Notifications.getExpoPushTokenAsync({ projectId })`, registers it through `registerPushTokenRequest({ token, platform })` in `lib/api/pushTokens.ts` (the `register_push_token` RPC, which moves the token to whoever is signed in — a token identifies the device, not the user), and keeps the token in `kvStorage` so sign-out can call `deletePushTokenRequest(token)` first (`tanstack-query` §2a). Nothing else in the app touches that table.
- `Notifications.setNotificationHandler` is set once, in the root layout, so foreground notifications show.
- **Credentials are free:** an APNs key for iOS and FCM v1 credentials from a Firebase project for Android, both uploaded with `eas credentials`; Android also needs that project's `google-services.json` as `android.googleServicesFile`. Sending goes through the `send-push` Edge Function (`edge-functions`), which prunes `DeviceNotRegistered` tokens.

## Store review prompt

- **`maybeRequestReview()`** (`lib/storeReview.ts`) is called after a positive moment (a completed core action). It returns early unless `StoreReview.hasAction()`, at least `REVIEW_MIN_COMPLETIONS` (3) completions have happened and at least `REVIEW_INTERVAL_DAYS` (90) have passed since the last prompt — both counters in `kvStorage` — then calls `StoreReview.requestReview()`. The OS decides whether the sheet appears; never block on it.
- A "Rate us" button opens `StoreReview.storeUrl()` with `Linking.openURL`. It never calls `requestReview()`, which cannot be forced.

## Account deletion

Required by both stores. Settings → "Delete account" → a confirm dialog → then, from `lib/api/account.ts`:

1. **An Apple user** (`session.user.app_metadata.providers` includes `apple`) signs in with Apple once more for a fresh `authorizationCode`, sent to the `revoke-apple-token` Edge Function. Apple requires the revoke; if it fails, log it and carry on.
2. **An app with uploads** lists the user's `<user id>/` folder and removes it with `supabase.storage.from(bucket).remove(paths)`; Supabase rejects a SQL delete from `storage.objects`.
3. `deleteMyAccountRequest()` (`supabase.rpc('delete_my_account')`), then the sign-out path (`tanstack-query` §2a), and the auth gate flips.

Tell the user that an active subscription is cancelled in the App Store or Play Store settings, with a link, because no app can cancel it for them. The `delete-account.md` page in `app-sites` explains the in-app path and gives an email route for anyone without the app, which Google Play requires; handle those by hand within 30 days, deleting the user and their Storage folder in the dashboard.

## Store pages

Each app has three Markdown pages in the public `app-sites` repo (`project-structure`): `privacy.md`, `support.md`, `delete-account.md`. Their URLs go into App Store Connect (privacy policy, support) and the Play Console (privacy policy, Data safety → account deletion). They exist before the first TestFlight build goes to anyone outside you.

## Required app config

`app.json` for every app: `version` (semver, bumped per store release), `scheme`, `ios.bundleIdentifier` and `android.package`, `ios.supportsTablet: true`, `ios.usesAppleSignIn: true`, `ios.appStoreUrl` and `android.playStoreUrl` once the listings exist (`StoreReview.storeUrl()` returns `null` without them), `userInterfaceStyle: "automatic"`, `experiments.typedRoutes: true`, `experiments.reactCompiler: true`, `runtimeVersion: { "policy": "fingerprint" }` with `updates.url` written by `eas update:configure`, and plugins for `expo-router`, `expo-sqlite`, `expo-apple-authentication`, plus `expo-notifications` (with `android.googleServicesFile`), `react-native-google-mobile-ads` and `expo-tracking-transparency` when those modules are on. Expo generates the iOS privacy manifest from plugins; a library that asks for a "required reason" entry gets it under `ios.privacyManifests`.

## Minimum supported version

`AppShell` renders `UpdateRequired` (`components/UpdateRequired/UpdateRequired.tsx`) instead of the app when `Constants.expoConfig.version` is lower by semver than `app_config.min_supported_version`: a short message and a button to `StoreReview.storeUrl()`, no way past. Raise the value in the dashboard to retire a release that must not run; it is the only reliable way to stop a broken build when store releases are the update path.

## Release

- **Builds happen on the Mac:** `pnpm build:ios` (`eas build --local --platform ios --profile production`) then `pnpm submit:ios` with `--path` to the `.ipa`; the same for Android with the `.aab`. EAS cloud builds only when away from the Mac, inside the free 15 + 15 a month. Submissions are free.
- **`eas.json`** has `cli.appVersionSource: "remote"` and three profiles: `development` (dev client, internal), `preview` (internal), `production` (`autoIncrement: true`, `channel: "production"`). Build numbers come from EAS so local and cloud builds share one counter; `version` is bumped by hand per store release.
- **Before every submission:** `pnpm typecheck && pnpm lint && pnpm test` green, pending migrations pushed, `min_supported_version` reviewed. TestFlight for testers; a new Play developer account runs a closed test with 12 testers for 14 days before its first production release.

## EAS Update policy

`expo-updates` stays installed with `runtimeVersion: { "policy": "fingerprint" }` and a channel per profile. It is for **JS-only hotfixes** (`eas update --channel production --environment production --message "…"`), never for a change that touches native code or a config plugin — those are store releases. The free plan serves updates to 1,000 monthly users; beyond that EAS stops serving them and the app keeps running its embedded bundle. That is accepted: store releases are the real update path.
