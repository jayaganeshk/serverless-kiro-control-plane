# Requirements Document

## Introduction

The Remote Kiro portal currently authenticates users via a redirect-based OAuth2 Authorization Code Flow with PKCE against the Cognito hosted UI. The login experience consists of a single button that redirects users away from the portal. The portal's visual design uses emoji icons for navigation and a color scheme that feels generic and AI-generated.

This feature replaces the hosted UI redirect flow with an inline custom login form that authenticates directly against Cognito APIs, and modernizes the portal's visual identity by replacing emoji icons with proper SVG icons, refining the color palette, and improving typography and spacing for a professional appearance.

## Glossary

- **Portal**: The Vue 3 single-page application located in `packages/portal` that serves as the management interface for Remote Kiro.
- **Auth_Module**: The TypeScript module at `packages/portal/src/auth.ts` responsible for authentication, token storage, and token refresh.
- **Login_Page**: The Vue component at `packages/portal/src/views/LoginPage.vue` that renders the sign-in interface.
- **Callback_Page**: The Vue component at `packages/portal/src/views/CallbackPage.vue` that handles OAuth redirect callbacks.
- **Sidebar**: The fixed left navigation panel rendered in `App.vue` containing brand, navigation links, and sign-out button.
- **Cognito_User_Pool**: The AWS Cognito User Pool configured via environment variables (VITE_COGNITO_DOMAIN, VITE_CLIENT_ID) that stores user credentials and issues tokens.
- **InitiateAuth_API**: The Cognito Identity Provider API action `InitiateAuth` with `USER_PASSWORD_AUTH` flow used to authenticate username/password credentials directly.
- **Icon_System**: The set of SVG icons used throughout the Portal for navigation and UI elements, replacing the current emoji-based icons.
- **Design_System**: The CSS custom properties, color palette, typography, and spacing rules defined in `style.css` that govern the Portal's visual appearance.

## Requirements

### Requirement 1: Inline Login Form

**User Story:** As a portal user, I want to sign in with my email and password directly on the login page, so that I do not get redirected to an external Cognito hosted UI.

#### Acceptance Criteria

1. THE Login_Page SHALL render an email input field and a password input field within an inline form.
2. WHEN the user submits the login form with valid credentials, THE Auth_Module SHALL call the Cognito InitiateAuth_API with the `USER_PASSWORD_AUTH` auth flow, passing the email and password.
3. WHEN the Cognito InitiateAuth_API returns authentication tokens, THE Auth_Module SHALL store the access token, ID token, and refresh token in localStorage using the existing token key conventions (kiro_access_token, kiro_refresh_token, kiro_id_token, kiro_token_expiry).
4. WHEN the Cognito InitiateAuth_API returns authentication tokens successfully, THE Login_Page SHALL redirect the user to the dashboard route.
5. IF the Cognito InitiateAuth_API returns an error (invalid credentials, user not found, or network failure), THEN THE Login_Page SHALL display a descriptive error message below the form without navigating away.
6. WHILE the login form submission is in progress, THE Login_Page SHALL disable the submit button and display a loading indicator.
7. THE Login_Page SHALL validate that both email and password fields are non-empty before allowing form submission.

### Requirement 2: Auth Challenge Handling

**User Story:** As a portal user, I want the login flow to handle Cognito auth challenges (such as NEW_PASSWORD_REQUIRED), so that I can complete required account setup steps without leaving the portal.

#### Acceptance Criteria

1. WHEN the Cognito InitiateAuth_API returns a `NEW_PASSWORD_REQUIRED` challenge, THE Login_Page SHALL display a new password input field prompting the user to set a new password.
2. WHEN the user submits a new password in response to a `NEW_PASSWORD_REQUIRED` challenge, THE Auth_Module SHALL call the Cognito `RespondToAuthChallenge` API with the new password and session token.
3. WHEN the `RespondToAuthChallenge` API returns authentication tokens, THE Auth_Module SHALL store the tokens and THE Login_Page SHALL redirect the user to the dashboard route.
4. IF the `RespondToAuthChallenge` API returns an error, THEN THE Login_Page SHALL display the error message to the user.

### Requirement 3: Auth Module Refactor

**User Story:** As a developer, I want the auth module to support direct username/password authentication via Cognito APIs, so that the portal no longer depends on the hosted UI redirect flow.

#### Acceptance Criteria

1. THE Auth_Module SHALL export a `signIn(email: string, password: string)` function that calls the Cognito InitiateAuth_API with `USER_PASSWORD_AUTH` flow.
2. THE Auth_Module SHALL export a `respondToChallenge(challengeName: string, session: string, responses: Record<string, string>)` function that calls the Cognito `RespondToAuthChallenge` API.
3. THE Auth_Module SHALL continue to export the existing `getToken`, `isAuthenticated`, `getValidToken`, and `refreshToken` functions with unchanged behavior.
4. THE Auth_Module SHALL continue to use the existing localStorage keys (kiro_access_token, kiro_refresh_token, kiro_id_token, kiro_token_expiry) for token storage.
5. THE Auth_Module SHALL export a `logout` function that clears all stored tokens and redirects to the login route (instead of the Cognito hosted logout endpoint).
6. THE Auth_Module SHALL use the Cognito User Pool region and User Pool Client ID derived from the existing environment variables (VITE_COGNITO_DOMAIN, VITE_CLIENT_ID) to construct API requests.
7. THE Auth_Module SHALL use the `refreshToken` function to call the Cognito InitiateAuth_API with `REFRESH_TOKEN_AUTH` flow instead of the hosted UI `/oauth2/token` endpoint.

### Requirement 4: Callback Page Update

**User Story:** As a developer, I want the callback page to handle the transition away from redirect-based auth gracefully, so that existing bookmarks or stale redirects do not break the user experience.

#### Acceptance Criteria

1. WHEN a user navigates to the callback route, THE Callback_Page SHALL redirect the user to the login route if no valid authorization code is present in the URL query parameters.
2. WHEN a user navigates to the callback route with a valid authorization code, THE Callback_Page SHALL attempt to exchange the code for tokens using the existing PKCE flow for backward compatibility during transition.
3. IF the token exchange fails on the callback route, THEN THE Callback_Page SHALL redirect the user to the login route.

### Requirement 5: Replace Emoji Icons with SVG Icons

**User Story:** As a portal user, I want the navigation and UI to use professional SVG icons instead of emoji, so that the portal looks polished and consistent across platforms.

#### Acceptance Criteria

1. THE Sidebar SHALL use SVG icons from a consistent icon library (Lucide) for all navigation items: Dashboard, Repositories, Profiles, New Job, and Admin.
2. THE Sidebar brand area SHALL display a professional SVG logo or icon instead of the "⚡" emoji.
3. THE Icon_System SHALL render SVG icons inline so that icon color inherits from the parent CSS color property.
4. THE Icon_System SHALL size all navigation icons consistently at a width and height that aligns with the sidebar text (approximately 18-20px).

### Requirement 6: Modernize Color Palette and Visual Design

**User Story:** As a portal user, I want the portal to have a refined, professional color palette and visual design, so that the interface feels intentionally designed rather than AI-generated.

#### Acceptance Criteria

1. THE Design_System SHALL define a primary color that is distinct from the current indigo (#4f46e5) and conveys a professional, modern tone.
2. THE Design_System SHALL define a cohesive set of CSS custom properties for background, surface, text, border, and accent colors that work harmoniously together.
3. THE Login_Page SHALL use a refined background treatment (subtle gradient or solid color) instead of the current gradient that appears generic.
4. THE Design_System SHALL define consistent spacing values using CSS custom properties for padding and margins throughout the Portal.
5. THE Design_System SHALL use a font stack that prioritizes Inter or a similar professional sans-serif typeface with improved font-weight distribution (regular body text at 400, medium labels at 500, bold headings at 600-700).

### Requirement 7: Sidebar and Layout Refinement

**User Story:** As a portal user, I want the sidebar and overall layout to feel clean and intentionally designed, so that navigating the portal is a pleasant experience.

#### Acceptance Criteria

1. THE Sidebar SHALL have refined spacing between navigation items, brand area, and footer that follows a consistent vertical rhythm.
2. THE Sidebar active navigation state SHALL use a visual indicator (such as a background highlight or left border accent) that is clearly distinguishable from inactive items.
3. THE Sidebar brand text SHALL display "Remote Kiro" without any emoji prefix, using typography and an optional SVG icon to convey brand identity.
4. THE Sidebar sign-out button SHALL have a hover state that clearly communicates the destructive nature of the action (such as a red-tinted background).

### Requirement 8: Token Management Continuity

**User Story:** As a developer, I want the existing token management, refresh logic, and route guards to continue working after the auth flow change, so that the migration does not break authenticated API calls.

#### Acceptance Criteria

1. THE Auth_Module `getValidToken` function SHALL return a valid access token by first checking localStorage and then attempting a refresh via the Cognito InitiateAuth_API with `REFRESH_TOKEN_AUTH` flow.
2. THE router navigation guard SHALL continue to redirect unauthenticated users (users without a valid token in localStorage) to the login route for all non-public routes.
3. WHEN the `refreshToken` function fails (expired refresh token or network error), THE Auth_Module SHALL clear all stored tokens and return null, causing the navigation guard to redirect to the login route.
4. THE Auth_Module SHALL continue to parse JWT expiry from the access token and store the expiry timestamp in localStorage under the `kiro_token_expiry` key.
