# Account Management API Specification

## 1. API Overview
- **Domain Context**: Core authentication and account identity management. Handles the lifecycle of a user account from registration and verification to credential management and self-service account deletion.
- **Architectural Style**: RESTful API.
- **Versioning Strategy**: Non-versioned internal API (prefix `/api`).
- **Base URL Conventions**: `/api`

## 2. Role-Based Access Control (RBAC) Model
The Account Management API primarily focuses on self-service operations for the authenticated principal.

### Role Hierarchy & Enforcement
- **Public**: Access to registration, sign-in, and password reset initiation.
- **Authenticated User**: Access to profile retrieval, account updates, and session management.
- **Enforcement Logic**: Authentication is verified via `auth.api.getSession`. Authorization for self-service is implicit based on the session principal (Resource Ownership).

### Permissions Matrix
| Endpoint | Method | Required Permission / Role | Enforcement Type |
|----------|--------|----------------------------|------------------|
| `/sign-up/email` | `POST` | Public | None |
| `/sign-in/email` | `POST` | Public | None |
| `/me` | `GET` | Authenticated | principal |
| `/update-account-info` | `POST` | Authenticated | principal |
| `/delete-account` | `POST` | Authenticated | principal + password |
| `/change-password` | `POST` | Authenticated | principal + old password |

## 3. Endpoint Specifications

### 3.1. User Registration
- **Route**: `POST /sign-up/email`
- **Purpose**: Registers a new user account via email and password.
- **Headers**: `Content-Type: application/json`
- **Request Schema**:
  - `name` (string, required): Full name.
  - `email` (string, required): Valid email address.
  - `password` (string, required): 8–128 characters.
  - `newsletter` (boolean, optional): Default `false`. If `true`, auto-subscribes to Mailchimp.
  - `accountType` (enum, optional): `free`, `develop`, `master`. Defaults to `free`.
  - `rememberMe` (boolean, optional): Extends session duration.

### 3.2. Get Current Account
- **Route**: `GET /me`
- **Purpose**: Retrieves the authenticated user's profile and role.
- **Headers**: `Authorization: Bearer <token>` or Session Cookie.
- **Response Schema**:
  ```json
  {
    "data": {
      "id": "string",
      "name": "string",
      "email": "string",
      "phone": "string | null",
      "image": "string | null",
      "role": "string",
      "emailVerified": "boolean"
    }
  }
  ```

### 3.3. Update Account Info
- **Route**: `POST /update-account-info`
- **Purpose**: Updates non-credential account fields (name, phone).
- **Validation**:
  - `name`: String, trimmed.
  - `phone`: Regex `/^\+?[0-9]{7,15}$/`.

### 3.4. Profile Photo Management
- **Upload**: `POST /account/upload-profile-photo` (Multipart/form-data, field `image`)
- **Remove**: `DELETE /account/remove-profile-photo`
- **Constraints**: 100MB limit (global), JPEG/PNG/WEBP.

## 4. Validation and Business Logic Flow
1. **Verification Loop**: Users are registered as `free` accounts by default. Email verification is mandatory via a 6-digit OTP flow.
2. **Transactional Integrity**: Registration integrates with downstream services (Mailchimp) via background-safe wrappers triggered in Better Auth `databaseHooks`.
3. **Password Security**: Credential changes require `currentPassword` verification. Minimum entropy is enforced by 8-character length.
4. **Session Persistence**: Cookies are configured as `lax` with `partitioned` support for cross-site stability in production.

## 5. Standardized Error Handling
- `401 Unauthorized`: Session expired or missing.
- `400 Bad Request`: Validation failure (e.g., invalid phone format).
- `422 Unprocessable Entity`: Business logic violation (e.g., email already in use).

## 6. Security Considerations
- **Input Sanitization**: All string inputs are trimmed and normalized.
- **Rate Limiting**: Applied to OTP and Sign-in routes via `strictLimiter`.
- **Session Protection**: Sign-out revokes the current session token.

## 7. Performance & Observability
- **Hotspots**: Password hashing (handled by Better Auth / Argon2).
- **Traceability**: All session activities are tracked via session ID in Better Auth logs.
