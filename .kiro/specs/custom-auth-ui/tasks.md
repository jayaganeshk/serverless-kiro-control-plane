# Implementation Plan: Custom Auth UI

## Overview

Refactor the portal's authentication from redirect-based Cognito hosted UI to inline login with direct Cognito IdP API calls, modernize the visual design with Lucide SVG icons, updated color palette, and refined layout. Implementation proceeds incrementally: dependencies → auth module → login page → callback page → icons & design system → sidebar → tests.

## Tasks

- [x] 1. Add project dependencies and configure test environment
  - [x] 1.1 Add runtime and dev dependencies to `packages/portal/package.json`
    - Add `lucide-vue-next` to dependencies
    - Add `vitest`, `fast-check`, `@vue/test-utils`, `jsdom` to devDependencies
    - Update the `test` script to `vitest --run`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 1.2 Create `packages/portal/vitest.config.ts` with jsdom environment
    - Configure vitest with `environment: 'jsdom'` and Vue plugin
    - _Requirements: (testing infrastructure)_

- [x] 2. Refactor auth module to use Cognito IdP API
  - [x] 2.1 Add `parseCognitoRegion` helper and `cognitoRequest` internal function in `packages/portal/src/auth.ts`
    - Parse region from `VITE_COGNITO_DOMAIN` (e.g., `ap-south-1` from `https://...auth.ap-south-1.amazoncognito.com`)
    - Implement `cognitoRequest(action, payload)` that POSTs to `https://cognito-idp.{region}.amazonaws.com/` with `X-Amz-Target` header
    - _Requirements: 3.6_

  - [ ]* 2.2 Write property test: region parsing (Property 7)
    - **Property 7: Region is correctly parsed from Cognito domain URL**
    - **Validates: Requirements 3.6**

  - [x] 2.3 Add `SignInResult`, `ChallengeResult` discriminated union types and implement `signIn` function
    - Define `AuthSuccess`, `AuthChallenge`, `AuthError` interfaces
    - Implement `signIn(email, password)` calling `InitiateAuth` with `USER_PASSWORD_AUTH`
    - Handle success (store tokens, return `AuthSuccess`), challenge (return `AuthChallenge`), and error (return `AuthError`) cases
    - Map Cognito error `__type` values to user-friendly messages per design error handling table
    - _Requirements: 1.2, 1.3, 1.5, 3.1_

  - [ ]* 2.4 Write property test: signIn request construction (Property 1)
    - **Property 1: signIn constructs a valid InitiateAuth request**
    - **Validates: Requirements 1.2, 3.1**

  - [ ]* 2.5 Write property test: Cognito error propagation (Property 3)
    - **Property 3: Cognito error messages are propagated**
    - **Validates: Requirements 1.5**

  - [x] 2.6 Implement `respondToChallenge` function
    - Call `RespondToAuthChallenge` API with challenge name, session, and responses
    - Store tokens on success, return `AuthError` on failure
    - _Requirements: 2.2, 2.3, 3.2_

  - [ ]* 2.7 Write property test: respondToChallenge request construction (Property 5)
    - **Property 5: respondToChallenge constructs a valid RespondToAuthChallenge request**
    - **Validates: Requirements 2.2, 3.2**

  - [x] 2.8 Refactor `refreshToken` to use `InitiateAuth` with `REFRESH_TOKEN_AUTH` flow
    - Replace the `/oauth2/token` fetch call with `cognitoRequest('InitiateAuth', ...)` using `REFRESH_TOKEN_AUTH`
    - On failure, call `clearTokens()` and return `false`
    - _Requirements: 3.7, 8.1, 8.3_

  - [ ]* 2.9 Write property test: refreshToken uses REFRESH_TOKEN_AUTH (Property 8)
    - **Property 8: refreshToken uses REFRESH_TOKEN_AUTH flow**
    - **Validates: Requirements 3.7**

  - [ ]* 2.10 Write property test: refreshToken failure clears tokens (Property 11)
    - **Property 11: refreshToken failure clears all tokens**
    - **Validates: Requirements 8.3**

  - [x] 2.11 Refactor `logout` to clear tokens and redirect to `/login` instead of Cognito hosted logout
    - Remove the Cognito `/logout` redirect
    - Use `window.location.href = '/login'` after clearing tokens
    - _Requirements: 3.5_

  - [ ]* 2.12 Write property test: logout clears all tokens (Property 6)
    - **Property 6: logout clears all stored tokens**
    - **Validates: Requirements 3.5**

  - [ ]* 2.13 Write property test: token storage round-trip (Property 2)
    - **Property 2: Token storage round-trip**
    - **Validates: Requirements 1.3, 2.3, 3.4**

  - [ ]* 2.14 Write property test: JWT expiry parsing (Property 12)
    - **Property 12: JWT expiry is correctly parsed and stored**
    - **Validates: Requirements 8.4**

  - [ ]* 2.15 Write property test: getValidToken behavior (Property 9)
    - **Property 9: getValidToken returns token or refreshes**
    - **Validates: Requirements 3.3, 8.1**

- [x] 3. Checkpoint — Auth module
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement inline login page with state machine
  - [x] 4.1 Rewrite `packages/portal/src/views/LoginPage.vue` with email/password form and state machine
    - Implement reactive state: `state` (`idle` | `loading` | `challenge` | `challenge-loading`), `email`, `password`, `newPassword`, `errorMessage`, `challengeSession`
    - Render email + password form in `idle`/`loading` states with submit button disabled during `loading`
    - On submit: validate non-empty fields, call `signIn`, handle `AuthSuccess` (redirect to dashboard), `AuthChallenge` (transition to challenge state), `AuthError` (display error)
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7_

  - [x] 4.2 Add challenge form UI for `NEW_PASSWORD_REQUIRED` in LoginPage.vue
    - Show new password input when state is `challenge` or `challenge-loading`
    - On submit: call `respondToChallenge` with session and new password
    - Handle success (redirect to dashboard) and error (display message)
    - Include a back/cancel link to return to idle state
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 4.3 Write unit tests for LoginPage.vue component
    - Test that email and password inputs render in idle state
    - Test submit button is disabled during loading state
    - Test challenge form appears on NEW_PASSWORD_REQUIRED
    - Test error message displays on auth failure
    - _Requirements: 1.1, 1.6, 2.1, 1.5_

- [x] 5. Update callback page for backward compatibility
  - [x] 5.1 Update `packages/portal/src/views/CallbackPage.vue` to redirect to login when no code is present
    - If no `code` query param, redirect to `/login`
    - If `code` is present, attempt PKCE exchange via existing `handleCallback`
    - On exchange failure, redirect to `/login`
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 5.2 Write unit tests for CallbackPage.vue
    - Test redirect to login when no code param
    - Test PKCE exchange attempt when code is present
    - Test redirect to login on exchange failure
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Checkpoint — Login and callback pages
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update CSS design system with new color palette and spacing tokens
  - [x] 7.1 Update `packages/portal/src/style.css` with new design system values
    - Change `--color-primary` to `#2563eb`, `--color-primary-hover` to `#1d4ed8`, `--color-primary-light` to `#eff6ff`
    - Change `--color-bg` to `#f8f9fb`, `--color-border` to `#e5e7eb`
    - Add spacing tokens: `--space-xs: 4px`, `--space-sm: 8px`, `--space-md: 16px`, `--space-lg: 24px`, `--space-xl: 32px`, `--space-2xl: 48px`
    - Update `.login-page` background to use `var(--color-bg)` or subtle single-tone gradient with new primary-light
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 8. Replace emoji icons with Lucide SVG icons in sidebar
  - [x] 8.1 Update `packages/portal/src/App.vue` to import and use Lucide icon components
    - Import `LayoutDashboard`, `FolderGit2`, `Puzzle`, `PlusCircle`, `Settings`, `LogOut`, `Zap` from `lucide-vue-next`
    - Replace all emoji `<span class="nav-icon">` elements with corresponding Lucide components at `:size="18"`
    - Replace `⚡` in brand with `<Zap :size="20" />` component
    - Add `<LogOut :size="16" />` icon to the sign-out button
    - Update sign-out button to call the refactored `logout` function
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 7.3_

  - [x] 8.2 Refine sidebar spacing and brand text in App.vue
    - Update brand text to "Remote Kiro" without emoji prefix
    - Ensure consistent vertical rhythm in nav items using spacing tokens
    - Verify active state visual indicator (left border accent) is clearly distinguishable
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 8.3 Write unit tests for App.vue sidebar
    - Test that Lucide icon components render in sidebar
    - Test brand text is "Remote Kiro" without emoji
    - Test icon size prop is 18
    - _Requirements: 5.1, 5.2, 5.4, 7.3_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties from the design document
- The existing PKCE flow (`handleCallback`, `login`) is preserved in auth.ts for backward compatibility but the login page no longer uses the redirect flow
- Checkpoints ensure incremental validation after auth module and UI changes
