# Implementation Plan: Forgot Password Flow

## Overview

Add forgot password and password visibility toggle to the login page using direct Cognito API calls.

## Tasks

- [x] 1. Add Cognito forgot password functions to auth module
  - [x] 1.1 Implement `forgotPassword(email)` in `packages/portal/src/auth.ts` calling Cognito `ForgotPassword` API
  - [x] 1.2 Implement `confirmForgotPassword(email, code, newPassword)` calling Cognito `ConfirmForgotPassword` API
  - [x] 1.3 Add error mapping for `CodeMismatchException`, `ExpiredCodeException`, `InvalidPasswordException`, `LimitExceededException`
  - [x] 1.4 Suppress `UserNotFoundException` in `forgotPassword` to prevent email enumeration

- [x] 2. Add password visibility toggle to login page
  - [x] 2.1 Import `Eye` and `EyeOff` from `lucide-vue-next`
  - [x] 2.2 Add `showPassword`, `showNewPassword`, `showResetPassword` refs
  - [x] 2.3 Wrap each password input in `.password-field` container with toggle button
  - [x] 2.4 Toggle input type between `password` and `text` on click

- [x] 3. Add forgot password form states to login page
  - [x] 3.1 Extend `FormState` type with `forgot`, `forgot-loading`, `reset`, `reset-loading`
  - [x] 3.2 Add "Forgot password?" link below sign-in button
  - [x] 3.3 Build forgot password email form (state: `forgot`)
  - [x] 3.4 Build verification code + new password form (state: `reset`)
  - [x] 3.5 Implement `handleForgotPassword()` and `handleResetPassword()` handlers
  - [x] 3.6 Show success message and auto-redirect to login on successful reset

- [x] 4. Add CSS styles
  - [x] 4.1 Add `.password-field`, `.toggle-vis` styles to `packages/portal/src/style.css`
  - [x] 4.2 Add `.forgot-link`, `.form-hint`, `.login-form .success` styles
