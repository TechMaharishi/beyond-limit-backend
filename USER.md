# User Management API Documentation

## 1. System Overview
**Domain Context**: This system provides complete User Lifecycle Management, covering Authentication (sign-up, sign-in, OTP flows), Administration (RBAC-gated account lifecycle, banning, assignment mapping), and Multi-profile Management (specifically for "user" accounts).
**Architectural Style**: RESTful API
**Versioning Strategy**: Implicit v1 convention (mounted via standard Express routing, typically under `/api`).
**Base URL**: `http://localhost:5000/api` (Environment dependent).

---

## 2. Role-Based Access Control (RBAC) Model
**Role Hierarchy & Scope**:
- **admin**: Full system access. Can create, update, delete, list, ban users, and manage profiles globally.
- **trainer**: Instructors with potential read access to user listings and ability to view assigned user profiles (permissions depend on system mapping).
- **trainee**: Internal learning staff. Standard access.
- **user**: Public consumers. Restricted to self-management and multi-profile sub-accounts (up to 5 profiles).

**Enforcement Logic**:
1. **Authentication**: `auth.api.getSession` intercepts requests and validates Bearer session tokens.
2. **Authorization**: `auth.api.userHasPermission` checks the requesting user's explicit permissions matrix.
3. **Resource Ownership**: Endpoints like `PATCH /profiles/:profileId` enforce that the `session.user.id` matches the `profile.userId`.
4. **Role Conditionals**: Profiles can *only* be created or managed if the account role strictly equals `"user"`.

**Permissions Matrix**:
- `user: ["create", "list", "update", "reset-password", "ban", "delete"]`
- `profile: ["manage", "view"]`

---

## 3. Standardized Error Handling Model
All errors generally follow standard HTTP status conventions. Uncaught exceptions map to a generic `500` through Express `next(error)`.
- **400 Bad Request**: Invalid input, failed regex, or business logic constraint failure (e.g., "Maximum 5 profiles allowed").
- **401 Unauthorized**: Missing or invalid session token.
- **403 Forbidden**: Valid token, but lacks required role, permission, or resource ownership.
- **404 Not Found**: Target entity (user, profile) does not exist in the database.
- **Payload Structure**: Typically `{ "error": "Human readable reason" }` or `{ "message": "Reason" }`.

---

## 4. Endpoint Specifications

### 4.1 Account & Authentication (`src/routes/user/account.ts`)

#### POST `/sign-up/email`
- **Purpose**: Register a new user account. Defaults to "free" accountType.
- **Auth Scheme**: Public
- **Request**:
  - `email` (string, required): Standard email format.
  - `password` (string, required)
  - `name` (string, required)
  - `newsletter` (boolean, optional, defaults to false)
  - `rememberMe` (boolean, optional)
- **Response (200/201)**: `{ "data": { "session": {...}, "user": {...} } }`

#### POST `/email-otp/send-verification-otp`
- **Purpose**: Send OTP for email verification.
- **Auth Scheme**: Public
- **Request**: `{ "email": "user@example.com" }`
- **Response (200)**: `{ "data": { "status": true } }`

#### POST `/verify-email-otp`
- **Purpose**: Complete email verification.
- **Auth Scheme**: Public
- **Request**: `{ "email": "user@example.com", "otp": "123456" }`
- **Response (200)**: `{ "data": { ... } }`

#### POST `/sign-in/email`
- **Purpose**: Authenticate user and issue session token.
- **Auth Scheme**: Public
- **Request**: `{ "email": "...", "password": "...", "rememberMe": true }`
- **Response (200)**: `{ "session": { "token": "...", "user": {...} } }`

#### POST `/sign-out`
- **Purpose**: Terminate current session.
- **Auth Scheme**: Bearer Token
- **Response (200)**: `{ "data": { "success": true } }`

#### POST `/change-password`
- **Purpose**: Update password for an authenticated user.
- **Auth Scheme**: Bearer Token
- **Request**: `{ "currentPassword": "...", "newPassword": "...", "revokeOtherSessions": true }`

#### Password Reset Flow
- **`POST /forget-password/email-otp`**: Request reset OTP via email. (`{ "email": "..." }`)
- **`POST /email-otp/check-verification-otp`**: Validate reset OTP. (`{ "email": "...", "otp": "..." }`)
- **`POST /email-otp/reset-password`**: Set new password. (`{ "email": "...", "otp": "...", "password": "..." }`)

#### POST `/delete-account`
- **Purpose**: Self-delete account.
- **Auth Scheme**: Bearer Token
- **Request**: `{ "password": "..." }`

#### GET `/me`
- **Purpose**: Retrieve current authenticated user context.
- **Auth Scheme**: Bearer Token
- **Response (200)**: `{ "data": { "id": "...", "name": "...", "email": "...", "role": "...", "emailVerified": true } }`

#### POST `/update-account-info`
- **Purpose**: Update user's name or phone number.
- **Auth Scheme**: Bearer Token
- **Request**:
  - `name` (string, optional)
  - `phone` (string, optional): Regex `^\+?[0-9]{7,15}$`.
- **Response (200)**: Returning updated `data` object.

#### POST `/account/upload-profile-photo`
- **Purpose**: Upload avatar directly to Cloudinary.
- **Auth Scheme**: Bearer Token (multipart/form-data)
- **Request**: File field `image`. Validates mimetype `image/*`.
- **Response (200)**: Returns Cloudinary URL and metadata.

#### DELETE `/account/remove-profile-photo`
- **Purpose**: Delete avatar from Cloudinary and DB.
- **Auth Scheme**: Bearer Token

---

### 4.2 Admin Operations (`src/routes/user/admin.ts`)

#### POST `/admin/create-user`
- **Purpose**: Create a user with a specific role, triggering welcome emails and mailchimp sync.
- **Roles/Perms**: `user: ["create"]`
- **Request**: `{ "email": "...", "password": "...", "name": "...", "role": "admin|trainer|trainee|user", "accountType": "free|develop|master", "phone": "...", "newsletter": boolean }`
- **Response (201)**: `{ "data": { ... } }`

#### GET `/admin/list-user/all` & `/admin/list-user`
- **Purpose**: Paginated listing of users, enriched with `ClinicalAssignment` data for trainees.
- **Roles/Perms**: `user: ["list"]`
- **Query Params**: `role`, `search`, `field` (email|name), `sortBy` (createdAt|updatedAt|name|email), `sortDirection` (asc|desc), `page`, `limit`.
- **Response (200)**: `{ "data": { "users": [...], "meta": { "total": 100, "page": 1, ... } } }`

#### POST `/admin/set-user-role`
- **Purpose**: Change a user's role. Triggers session/profile cleanup side-effects.
- **Roles/Perms**: `user: ["update"]`
- **Request**: `{ "userId": "...", "role": "admin|trainer|trainee|user" }`
- **Side Effects**: If transitioning to "user", creates a default profile. If transitioning away from "user", clears all active profile sessions.

#### POST `/admin/reset-user-password`
- **Roles/Perms**: `user: ["reset-password"]`
- **Request**: `{ "userId": "...", "newPassword": "..." }`

#### POST `/admin/ban-user` & `/admin/unban-user`
- **Roles/Perms**: `user: ["ban"]`
- **Request (Ban)**: `{ "userId": "...", "banReason": "...", "banExpiresIn": "7d" }`

#### POST `/admin/delete-users`
- **Purpose**: Bulk delete users. Max 100 per request.
- **Roles/Perms**: `user: ["delete"]`
- **Request**: `{ "userIds": ["id1", "id2"] }`
- **Response (200)**: `{ "data": { "success": [...], "failed": [...] } }`

#### Admin Profile Management
- **GET `/admin/profiles?userId=...`**: List profiles for a target user (`profile: ["manage"]`).
- **POST `/admin/profiles`**: Create profile for target user (`profile: ["manage"]`).
- **PATCH `/admin/profiles/:profileId`**: Update profile.
- **DELETE `/admin/profiles/:profileId`**: Delete profile (Cannot delete last profile if role is 'user').
- **GET `/admin/user-profiles?userId=...`**: Read-only lookup for assignments (`profile: ["view"]`).

---

### 4.3 Profile Management (`src/routes/user/profiles.ts`)
*All endpoints here require the authenticated session to possess the `"user"` role.*

#### GET `/profiles`
- **Purpose**: List up to 5 profiles owned by the current user. Includes `activeProfileId`.

#### POST `/profiles`
- **Purpose**: Create a new profile (max 5 per user). Supports optional avatar upload.
- **Request (JSON)**: `{ "name": "...", "avatar": "..." }`
- **Request (Multipart)**: `multipart/form-data` with fields `name` (string) and `image` (file).
- **Logic boundary**: Uses MongoDB Transactions to guarantee atomicity of the max-5 count check.

#### PATCH `/profiles/:profileId`
- **Purpose**: Edit own profile name or avatar. Supports avatar replacement/deletion.
- **Request (JSON)**: `{ "name": "...", "avatar": "..." }` (Sending `avatar: ""` explicitly deletes the photo from Cloudinary).
- **Request (Multipart)**: `multipart/form-data` with fields `name` (string) and `image` (file). Overwrites any existing photo in Cloudinary automatically.

#### DELETE `/profiles/:profileId`
- **Purpose**: Delete a profile.
- **Logic**: Enforces that at least 1 profile remains. Removes the profile ID from any active sessions across devices (`clearProfileFromAllSessions`).

#### POST `/profiles/switch`
- **Purpose**: Set the active profile ID on the current JWT/Session token.
- **Request**: `{ "profileId": "..." }`
- **Response (200)**: `{ "data": { "activeProfileId": "..." } }`

#### POST `/profiles/:profileId/avatar`
- **Purpose**: Upload an avatar directly to Cloudinary for a specific profile.
- **Auth Scheme**: Bearer Token (multipart/form-data)
- **Request**: File field `image`. Validates mimetype `image/*`.
- **Response (200)**: `{ "data": { "avatar": "https://res.cloudinary.com/..." } }`
- **cURL Example**:
  ```bash
  curl -X POST http://localhost:5000/api/profiles/PROFILE_ID/avatar \
    -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
    -F "image=@/path/to/your/avatar.jpg"
  ```

#### DELETE `/profiles/:profileId/avatar`
- **Purpose**: Delete the avatar from Cloudinary and remove it from the specific profile.
- **Auth Scheme**: Bearer Token
- **Response (200)**: `{ "data": { "avatar": null, "deleted": true } }`
- **cURL Example**:
  ```bash
  curl -X DELETE http://localhost:5000/api/profiles/PROFILE_ID/avatar \
    -H "Authorization: Bearer YOUR_SESSION_TOKEN"
  ```

---

## 5. Security & Edge Case Considerations

1. **Transaction Boundaries**:
   - `POST /profiles` utilizes MongoDB `startSession().withTransaction()` to ensure thread-safe enforcement of the `MAX_PROFILES = 5` limit, preventing race conditions during concurrent requests.
2. **Side Effect Cascades**:
   - Downgrading a user role *from* `"user"` to something else via `POST /admin/set-user-role` immediately triggers `clearAllActiveProfilesForUser`, ensuring no stale session states remain.
   - Deleting a profile dynamically calls `clearSessionActiveProfile(token)` and `clearProfileFromAllSessions`, instantly revoking access across multi-device logins.
3. **Third-party Syncing (Idempotency/Fail-safe)**:
   - Mailchimp subscription (`subscribeEmailToMailchimpSafe`) and email sending are designed not to crash the main `create-user` transaction if the network fails.
4. **Input Sanitization**:
   - Explicit `.trim()` operations on userIds, roles, names, and phone numbers.
   - Strictly controlled enums (`allowedRoles`, `allowedAccountTypes`, `allowedFields`).
5. **Rate Limiting**: (Assumed configured globally at the Express/Nginx layer, not explicitly defined in these route controllers, but standard `express-rate-limit` is highly recommended for OTP flows).

---

## 6. Performance & Observability
- **Complexity Hotspots**:
   - `GET /admin/list-user/all`: Contains an `O(N)` mapping transformation enriched by a MongoDB `$in` array query to fetch `ClinicalAssignments`. The limit is capped at `100` to prevent `O(N^2)` memory exhaustion.
   - `POST /admin/delete-users`: Executes deletions sequentially in batches of 10 (`concurrency = 10`) via `Promise.allSettled`. This controls connection pool exhaustion and memory spikes on bulk admin operations.
- **Caching**: Profile fetches do not heavily cache at the Redis layer, trading latency for strict consistency (necessary to prevent deleted profiles from being utilized).
- **Audit Logging**: `auth.api` (Better Auth) internally logs session lifecycle events. Explicit console errors are logged on asynchronous side-effect failures (e.g., `[SetUserRole] Session clearing failed...`).

---

## 7. Assumptions & Constraints
1. **Database Schema**: Expects a MongoDB Replica Set to be configured, as Profile creation utilizes ACID transactions (`.startSession()`).
2. **Cloudinary Structure**: Expects the Cloudinary public ID strategy to be predictable (`profiles/{userId}`) for deterministic overwrites and fast deletions.
3. **Role Semantics**: A `"user"` role represents a parent subscriber who acts through sub-`"profiles"` (e.g., streaming service models). `"trainer"`/`"trainee"` roles map directly to individuals and do not use the sub-profile system.
