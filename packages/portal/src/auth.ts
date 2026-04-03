// ─── Cognito Auth Module ───
// OAuth2 Authorization Code Flow with PKCE (no SDK required)

const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;
const CLIENT_ID = import.meta.env.VITE_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_REDIRECT_URI;
const LOGOUT_URI = import.meta.env.VITE_COGNITO_LOGOUT_URI || REDIRECT_URI;

const TOKEN_KEY = "kiro_access_token";
const REFRESH_TOKEN_KEY = "kiro_refresh_token";
const ID_TOKEN_KEY = "kiro_id_token";
const EXPIRY_KEY = "kiro_token_expiry";
const PKCE_VERIFIER_KEY = "kiro_pkce_verifier";

// ─── Cognito IdP Helpers ───

/** Extracts the AWS region from a Cognito domain URL (e.g. "ap-south-1" from "https://...auth.ap-south-1.amazoncognito.com"). */
export function parseCognitoRegion(domain: string): string {
  const match = domain.match(/\.auth\.([a-z0-9-]+)\.amazoncognito\.com/);
  if (!match) {
    throw new Error(`Unable to parse region from Cognito domain: ${domain}`);
  }
  return match[1];
}

const COGNITO_REGION = parseCognitoRegion(COGNITO_DOMAIN);
const COGNITO_IDP_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

async function cognitoRequest(action: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(COGNITO_IDP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
    },
    body: JSON.stringify(payload),
  });
}

// ─── PKCE Helpers ───

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest("SHA-256", encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = generateRandomString(64);
  const hashed = await sha256(verifier);
  const challenge = base64UrlEncode(hashed);
  return { verifier, challenge };
}

// ─── Result Types ───

export interface AuthSuccess {
  success: true;
}

export interface AuthChallenge {
  challenge: string;
  session: string;
  parameters: Record<string, string>;
}

export interface AuthError {
  error: string;
}

export type SignInResult = AuthSuccess | AuthChallenge | AuthError;
export type ChallengeResult = AuthSuccess | AuthError;

// ─── Error Mapping ───

const COGNITO_ERROR_MESSAGES: Record<string, string> = {
  NotAuthorizedException: "Incorrect email or password.",
  UserNotFoundException: "Incorrect email or password.",
  UserNotConfirmedException: "Your account has not been confirmed. Please check your email.",
  InvalidParameterException: "Something went wrong. Please try again.",
};

const NETWORK_ERROR_MESSAGE = "Unable to connect. Please check your network and try again.";
const UNKNOWN_ERROR_MESSAGE = "An unexpected error occurred. Please try again.";

function mapCognitoError(errorType: string | undefined): string {
  if (errorType && COGNITO_ERROR_MESSAGES[errorType]) {
    return COGNITO_ERROR_MESSAGES[errorType];
  }
  return UNKNOWN_ERROR_MESSAGE;
}

// ─── Token Helpers ───

function parseJwtExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function storeTokens(accessToken: string, refreshToken: string | null, idToken: string | null): void {
  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  if (idToken) localStorage.setItem(ID_TOKEN_KEY, idToken);

  const expiry = parseJwtExpiry(accessToken);
  if (expiry) localStorage.setItem(EXPIRY_KEY, String(expiry));
}

function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ID_TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  localStorage.removeItem(PKCE_VERIFIER_KEY);
}

// ─── Public API ───

/** Returns the current access token, or null if not authenticated or expired. */
export function getToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  const expiry = localStorage.getItem(EXPIRY_KEY);
  if (expiry && Date.now() >= Number(expiry)) {
    // Token expired — caller should attempt refresh
    return null;
  }
  return token;
}

/** Returns true if a non-expired access token exists. */
export function isAuthenticated(): boolean {
  return getToken() !== null;
}

/** Redirects the browser to the Cognito hosted login page with PKCE. */
export async function login(): Promise<void> {
  const { verifier, challenge } = await generatePKCE();
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email",
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  window.location.href = `${COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
}

/** Clears stored tokens and redirects to /login. */
export function logout(): void {
  clearTokens();
  window.location.href = '/login';
}

/** Exchanges an authorization code (from callback URL) for tokens. */
export async function handleCallback(code: string): Promise<boolean> {
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!verifier) return false;

  try {
    const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code,
        code_verifier: verifier,
      }),
    });

    if (!response.ok) return false;

    const data = (await response.json()) as { access_token: string; refresh_token?: string; id_token?: string };
    storeTokens(data.access_token, data.refresh_token ?? null, data.id_token ?? null);
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Attempts to refresh the access token using the stored refresh token. Returns true on success. */
export async function refreshToken(): Promise<boolean> {
  const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refresh) return false;

  try {
    const response = await cognitoRequest("InitiateAuth", {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: refresh,
      },
    });

    if (!response.ok) {
      clearTokens();
      return false;
    }

    const data = (await response.json()) as { AuthenticationResult: { AccessToken: string; IdToken?: string } };
    const result = data.AuthenticationResult;
    storeTokens(result.AccessToken, null, result.IdToken ?? null);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

/**
 * Returns a valid access token, refreshing if needed.
 * Returns null if no valid token can be obtained (user must re-login).
 */
export async function getValidToken(): Promise<string | null> {
  const token = getToken();
  if (token) return token;

  // Token expired or missing — try refresh
  const refreshed = await refreshToken();
  if (refreshed) return getToken();

  return null;
}

// ─── Direct Auth API ───

/** Respond to an auth challenge (e.g. NEW_PASSWORD_REQUIRED). Never throws. */
export async function respondToChallenge(
  challengeName: string,
  session: string,
  responses: Record<string, string>
): Promise<ChallengeResult> {
  try {
    const response = await cognitoRequest("RespondToAuthChallenge", {
      ChallengeName: challengeName,
      ClientId: CLIENT_ID,
      Session: session,
      ChallengeResponses: responses,
    });

    const data = await response.json();

    if (!response.ok) {
      const errorType = data.__type?.split("#").pop();
      return { error: mapCognitoError(errorType) };
    }

    const result = data.AuthenticationResult;
    if (!result) {
      return { error: UNKNOWN_ERROR_MESSAGE };
    }

    storeTokens(result.AccessToken, result.RefreshToken ?? null, result.IdToken ?? null);
    return { success: true };
  } catch {
    return { error: NETWORK_ERROR_MESSAGE };
  }
}

/** Initiate forgot password flow (sends verification code). Never throws. */
export async function forgotPassword(email: string): Promise<AuthSuccess | AuthError> {
  try {
    const response = await cognitoRequest("ForgotPassword", {
      ClientId: CLIENT_ID,
      Username: email,
    });

    if (!response.ok) {
      const data = await response.json();
      const errorType = data.__type?.split("#").pop();
      if (errorType === "UserNotFoundException") {
        return { success: true };
      }
      return { error: mapCognitoError(errorType) };
    }

    return { success: true };
  } catch {
    return { error: NETWORK_ERROR_MESSAGE };
  }
}

/** Confirm password reset with verification code. Never throws. */
export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<AuthSuccess | AuthError> {
  try {
    const response = await cognitoRequest("ConfirmForgotPassword", {
      ClientId: CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
    });

    if (!response.ok) {
      const data = await response.json();
      const errorType = data.__type?.split("#").pop();
      const RESET_ERRORS: Record<string, string> = {
        CodeMismatchException: "Invalid verification code. Please try again.",
        ExpiredCodeException: "Verification code expired. Please request a new one.",
        InvalidPasswordException: "Password does not meet requirements. Use at least 8 characters with uppercase, lowercase, numbers, and symbols.",
        LimitExceededException: "Too many attempts. Please try again later.",
      };
      return { error: RESET_ERRORS[errorType ?? ""] ?? mapCognitoError(errorType) };
    }

    return { success: true };
  } catch {
    return { error: NETWORK_ERROR_MESSAGE };
  }
}

/** Authenticate with email/password via Cognito InitiateAuth API. Never throws. */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  try {
    const response = await cognitoRequest("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      const errorType = data.__type?.split("#").pop();
      return { error: mapCognitoError(errorType) };
    }

    // Challenge response (e.g. NEW_PASSWORD_REQUIRED)
    if (data.ChallengeName) {
      return {
        challenge: data.ChallengeName,
        session: data.Session,
        parameters: data.ChallengeParameters ?? {},
      };
    }

    // Success — store tokens
    const result = data.AuthenticationResult;
    storeTokens(result.AccessToken, result.RefreshToken ?? null, result.IdToken ?? null);
    return { success: true };
  } catch {
    return { error: NETWORK_ERROR_MESSAGE };
  }
}
