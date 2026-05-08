# Profile Management API Specification

## 1. API Overview
- **Domain Context**: Multi-profile management for standard user accounts. Allows a single authentication principal to maintain up to 5 distinct learning profiles (e.g., for different family members or learning paths).
- **Architectural Style**: RESTful API.
- **Base URL Conventions**: `/api/profiles`

## 2. Role-Based Access Control (RBAC) Model
- **Target Role**: Strictly limited to accounts with `role: "user"`.
- **Authorization**: Ownership-based. A user can only manage profiles where `profile.userId === currentUserId`.
- **Automated Lifecycle**: A default profile named "Profile 1" is automatically created via `databaseHooks` upon initial user registration.
- **Session State**: One profile is marked as "active" in the session metadata via the `activeProfileId` additional field in the Better Auth session schema.

## 3. Endpoint Specifications

### 3.1. List My Profiles
- **Route**: `GET /profiles`
- **Purpose**: Retrieves all profiles for the caller and the currently active profile ID.
- **Response**:
  ```json
  {
    "data": {
      "profiles": [...],
      "activeProfileId": "string | null"
    }
  }
  ```

### 3.2. Create Profile
- **Route**: `POST /profiles`
- **Constraints**:
  - `MAX_PROFILES`: 5 per account.
  - `name`: Required, non-empty string.
- **Validation**: Enforced via MongoDB Transaction to prevent race condition breaches of the limit.

### 3.3. Update Profile
- **Route**: `PATCH /profiles/:profileId`
- **Payload**: `name`, `avatar`.
- **Logic**: Handles avatar replacement and Cloudinary synchronization.

### 3.4. Switch Active Profile
- **Route**: `POST /profiles/switch`
- **Purpose**: Sets the `activeProfileId` for the current session.
- **Effect**: Updates the session principal's context in Redis/DB for downstream authorization checks.

### 3.5. Delete Profile
- **Route**: `DELETE /profiles/:profileId`
- **Constraints**:
  - Cannot delete the last remaining profile.
- **Side Effects**:
  - Destroys associated Cloudinary assets.
  - Clears `activeProfileId` from the current session if it was the target.
  - Clears the profile from all other concurrent device sessions for the user.

## 4. Business Logic Flow
1. **Creation**: `CreateMyProfile` starts a session -> enters transaction -> counts existing documents -> inserts if `< 5`.
2. **Avatar Lifecycle**: 
   - Upload uses `overwrite: true` with `public_id = profileId`.
   - Deletion uses `safeCloudinaryDestroy` to ensure the DB record is cleaned even if the Cloudinary API call fails.
3. **Session Sync**: Switching or deleting profiles triggers session metadata updates across all user devices.

## 5. Security & Rate Limiting
- **Rate Limiting**:
  - Mutations (`POST`, `PATCH`, `DELETE`): `writeLimiter`.
  - Avatar Uploads: `strictLimiter`.
- **Validation**: `isValidObjectId` checks for every `:profileId` parameter.

## 6. Performance Considerations
- **Concurrency**: Transactions used only for creation.
- **Latency**: Cloudinary operations are awaited but handled with safe-wrappers to prevent blocking DB state updates on timeout.
- **Caching**: Profile lists are not cached as they change with active session state.
