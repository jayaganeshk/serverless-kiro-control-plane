<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">
        <Zap :size="28" />
      </div>
      <h1>Remote Kiro</h1>
      <p class="subtitle">Sign in to manage repositories, profiles, and jobs.</p>

      <!-- Sign In Form -->
      <form v-if="state === 'idle' || state === 'loading'" @submit.prevent="handleSignIn" class="login-form">
        <div>
          <label for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="username"
            required
          />
        </div>
        <div>
          <label for="password">Password</label>
          <div class="password-field">
            <input
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="Enter your password"
              autocomplete="current-password"
              required
            />
            <button type="button" class="toggle-vis" @click="showPassword = !showPassword" tabindex="-1" :title="showPassword ? 'Hide password' : 'Show password'">
              <EyeOff v-if="showPassword" :size="18" />
              <Eye v-else :size="18" />
            </button>
          </div>
        </div>
        <button type="submit" :disabled="state === 'loading'">
          {{ state === 'loading' ? 'Signing in...' : 'Sign In' }}
        </button>
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <a href="#" class="forgot-link" @click.prevent="startForgotPassword">Forgot password?</a>
      </form>

      <!-- New Password Challenge -->
      <form v-if="state === 'challenge' || state === 'challenge-loading'" @submit.prevent="handleChallenge" class="login-form">
        <h2>Set New Password</h2>
        <div>
          <label for="newPassword">New Password</label>
          <div class="password-field">
            <input
              id="newPassword"
              v-model="newPassword"
              :type="showNewPassword ? 'text' : 'password'"
              placeholder="Enter your new password"
              autocomplete="new-password"
              required
            />
            <button type="button" class="toggle-vis" @click="showNewPassword = !showNewPassword" tabindex="-1">
              <EyeOff v-if="showNewPassword" :size="18" />
              <Eye v-else :size="18" />
            </button>
          </div>
        </div>
        <button type="submit" :disabled="state === 'challenge-loading'">
          {{ state === 'challenge-loading' ? 'Setting password...' : 'Set Password' }}
        </button>
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <a href="#" class="back-link" @click.prevent="backToLogin">Back to login</a>
      </form>

      <!-- Forgot Password: enter email -->
      <form v-if="state === 'forgot' || state === 'forgot-loading'" @submit.prevent="handleForgotPassword" class="login-form">
        <h2>Reset Password</h2>
        <p class="form-hint">Enter your email and we'll send a verification code.</p>
        <div>
          <label for="forgotEmail">Email</label>
          <input
            id="forgotEmail"
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="username"
            required
          />
        </div>
        <button type="submit" :disabled="state === 'forgot-loading'">
          {{ state === 'forgot-loading' ? 'Sending code...' : 'Send Reset Code' }}
        </button>
        <p v-if="successMessage" class="success">{{ successMessage }}</p>
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <a href="#" class="back-link" @click.prevent="backToLogin">Back to login</a>
      </form>

      <!-- Forgot Password: enter code + new password -->
      <form v-if="state === 'reset' || state === 'reset-loading'" @submit.prevent="handleResetPassword" class="login-form">
        <h2>Enter Verification Code</h2>
        <p class="form-hint">A code was sent to <strong>{{ email }}</strong>.</p>
        <div>
          <label for="resetCode">Verification Code</label>
          <input
            id="resetCode"
            v-model="resetCode"
            type="text"
            placeholder="Enter 6-digit code"
            autocomplete="one-time-code"
            required
          />
        </div>
        <div>
          <label for="resetPassword">New Password</label>
          <div class="password-field">
            <input
              id="resetPassword"
              v-model="resetNewPassword"
              :type="showResetPassword ? 'text' : 'password'"
              placeholder="Enter new password"
              autocomplete="new-password"
              required
            />
            <button type="button" class="toggle-vis" @click="showResetPassword = !showResetPassword" tabindex="-1">
              <EyeOff v-if="showResetPassword" :size="18" />
              <Eye v-else :size="18" />
            </button>
          </div>
        </div>
        <button type="submit" :disabled="state === 'reset-loading'">
          {{ state === 'reset-loading' ? 'Resetting...' : 'Reset Password' }}
        </button>
        <p v-if="successMessage" class="success">{{ successMessage }}</p>
        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
        <a href="#" class="back-link" @click.prevent="backToLogin">Back to login</a>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { Zap, Eye, EyeOff } from 'lucide-vue-next';
import { signIn, respondToChallenge, forgotPassword, confirmForgotPassword } from '../auth';

type FormState = 'idle' | 'loading' | 'challenge' | 'challenge-loading'
  | 'forgot' | 'forgot-loading' | 'reset' | 'reset-loading';

const router = useRouter();

const state = ref<FormState>('idle');
const email = ref('');
const password = ref('');
const newPassword = ref('');
const errorMessage = ref('');
const successMessage = ref('');
const challengeSession = ref('');

const showPassword = ref(false);
const showNewPassword = ref(false);
const showResetPassword = ref(false);
const resetCode = ref('');
const resetNewPassword = ref('');

async function handleSignIn() {
  errorMessage.value = '';

  if (!email.value.trim() || !password.value.trim()) {
    errorMessage.value = 'Please enter both email and password.';
    return;
  }

  state.value = 'loading';

  const result = await signIn(email.value, password.value);

  if ('success' in result) {
    router.push({ name: 'dashboard' });
  } else if ('challenge' in result) {
    challengeSession.value = result.session;
    state.value = 'challenge';
  } else {
    errorMessage.value = result.error;
    state.value = 'idle';
  }
}

async function handleChallenge() {
  errorMessage.value = '';

  if (!newPassword.value.trim()) {
    errorMessage.value = 'Please enter a new password.';
    return;
  }

  state.value = 'challenge-loading';

  const result = await respondToChallenge('NEW_PASSWORD_REQUIRED', challengeSession.value, {
    USERNAME: email.value,
    NEW_PASSWORD: newPassword.value,
  });

  if ('success' in result) {
    router.push({ name: 'dashboard' });
  } else {
    errorMessage.value = result.error;
    state.value = 'challenge';
  }
}

function startForgotPassword() {
  errorMessage.value = '';
  successMessage.value = '';
  state.value = 'forgot';
}

async function handleForgotPassword() {
  errorMessage.value = '';
  successMessage.value = '';

  if (!email.value.trim()) {
    errorMessage.value = 'Please enter your email.';
    return;
  }

  state.value = 'forgot-loading';
  const result = await forgotPassword(email.value);

  if ('success' in result) {
    state.value = 'reset';
    successMessage.value = '';
  } else {
    errorMessage.value = result.error;
    state.value = 'forgot';
  }
}

async function handleResetPassword() {
  errorMessage.value = '';
  successMessage.value = '';

  if (!resetCode.value.trim() || !resetNewPassword.value.trim()) {
    errorMessage.value = 'Please enter the verification code and a new password.';
    return;
  }

  state.value = 'reset-loading';
  const result = await confirmForgotPassword(email.value, resetCode.value.trim(), resetNewPassword.value);

  if ('success' in result) {
    successMessage.value = 'Password reset! Redirecting to login...';
    resetCode.value = '';
    resetNewPassword.value = '';
    setTimeout(() => {
      successMessage.value = '';
      password.value = '';
      state.value = 'idle';
    }, 2000);
  } else {
    errorMessage.value = result.error;
    state.value = 'reset';
  }
}

function backToLogin() {
  state.value = 'idle';
  newPassword.value = '';
  resetCode.value = '';
  resetNewPassword.value = '';
  errorMessage.value = '';
  successMessage.value = '';
  challengeSession.value = '';
}
</script>
