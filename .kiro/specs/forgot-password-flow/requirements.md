# Requirements Document

## Introduction

The Forgot Password Flow adds self-service password reset capability to the login page. Users who have forgotten their password can request a verification code sent to their email, then use that code along with a new password to reset their credentials. The feature also adds a password visibility toggle to all password input fields for improved usability. Both features use the Cognito Identity Provider API directly (no hosted UI redirect), consistent with the existing inline authentication approach.

## Glossary

- **ForgotPassword_API**: The Cognito Identity Provider API action `ForgotPassword` that sends a verification code to the user's email.
- **ConfirmForgotPassword_API**: The Cognito Identity Provider API action `ConfirmForgotPassword` that resets the password using the verification code.
- **Password_Visibility_Toggle**: An eye/eye-off icon button that toggles the password input between `type="password"` and `type="text"`.

## Requirements

### Requirement 1: Forgot Password Initiation

**User Story:** As a user who has forgotten their password, I want to request a password reset from the login page, so that I can regain access to my account without admin intervention.

#### Acceptance Criteria

1. THE Login_Page SHALL display a "Forgot password?" link below the sign-in button.
2. WHEN the user clicks "Forgot password?", THE Login_Page SHALL display a form requesting the user's email address.
3. WHEN the user submits the email, THE Auth_Module SHALL call the Cognito ForgotPassword_API.
4. IF the API call succeeds, THE Login_Page SHALL transition to the verification code entry form.
5. IF the user does not exist, THE Auth_Module SHALL still return success to prevent email enumeration.
6. IF a network error occurs, THE Login_Page SHALL display an appropriate error message.

### Requirement 2: Password Reset Confirmation

**User Story:** As a user who has received a verification code, I want to enter the code and a new password to complete the reset, so that I can sign in with my new password.

#### Acceptance Criteria

1. THE verification form SHALL display fields for the verification code and new password.
2. WHEN the user submits the form, THE Auth_Module SHALL call the Cognito ConfirmForgotPassword_API with the email, code, and new password.
3. IF the reset succeeds, THE Login_Page SHALL display a success message and redirect to the sign-in form after 2 seconds.
4. IF the verification code is invalid or expired, THE Login_Page SHALL display a specific error message.
5. IF the new password does not meet Cognito policy requirements, THE Login_Page SHALL display the policy violation message.
6. A "Back to login" link SHALL be available on all forgot-password screens.

### Requirement 3: Password Visibility Toggle

**User Story:** As a user, I want to toggle password visibility on all password fields, so that I can verify what I'm typing.

#### Acceptance Criteria

1. ALL password input fields (sign-in, new password challenge, reset password) SHALL display an eye icon button.
2. WHEN the user clicks the eye icon, THE input type SHALL toggle between `password` and `text`.
3. THE icon SHALL change between Eye (hidden) and EyeOff (visible) to indicate the current state.
4. THE toggle button SHALL not submit the form or shift focus from the input field.
