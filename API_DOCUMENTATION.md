# API Documentation: User, Admin, and Profiles

This document provides comprehensive details for the User Authentication, Account Management, Admin Operations, and User Profile APIs. The backend utilizes **Better Auth** for robust session management, role-based access control (RBAC), and authentication flows. 

**Base API URL:** `http://localhost:5000/api`

Authentication is typically handled via standard Better Auth mechanisms (Cookies or `Authorization: Bearer <token>` headers).

> **Note**: For all authenticated routes below, if you are not using cookies, pass the session token in the Authorization header: `-H "Authorization: Bearer <your_session_token>"`

---

## 1. Authentication & Account Management
**Source:** `src/routes/user/account.ts`

### 1.0 Get Session
**Endpoint:** `GET /auth/get-session`
- **Description:** Retrieves the current active session and user data. This is a core Better Auth endpoint used to verify authentication status.

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/auth/get-session" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Cookie: __Secure-better-auth.session_token=YOUR_SESSION_TOKEN"
```

**Response Example (200 OK):**
```json
{
    "session": {
        "expiresAt": "2026-05-10T02:29:19.331Z",
        "token": "YTetXAAdOUJTTEQMmbziBwQuGXtLLjBu",
        "createdAt": "2026-04-26T19:50:21.118Z",
        "updatedAt": "2026-05-03T02:29:19.331Z",
        "ipAddress": "",
        "userAgent": "PostmanRuntime/7.53.0",
        "userId": "69ea8ad06f8ba4f6a0f6bf28",
        "activeProfileId": null,
        "id": "69ee6c7ddeb88b39185de13a"
    },
    "user": {
        "name": "Jane New Name",
        "email": "nayiy30927@pertok.com",
        "emailVerified": true,
        "image": "",
        "createdAt": "2026-04-23T21:10:40.513Z",
        "updatedAt": "2026-04-25T10:41:41.157Z",
        "role": "user",
        "banned": false,
        "banReason": null,
        "banExpires": null,
        "phone": "+1234567890",
        "newsletter": false,
        "accountType": "free",
        "id": "69ea8ad06f8ba4f6a0f6bf28"
    }
}
```

### 1.1 Sign Up (Email & Password)
**Endpoint:** `POST /sign-up/email`
- **Description:** Registers a new user account with a default `free` account type.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/sign-up/email" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Doe",
    "email": "john@example.com",
    "password": "SecurePassword123!",
    "newsletter": true,
    "rememberMe": true
  }'
```

**Response Example (200 OK):**
```json
{
  "data": {
    "user": {
      "id": "5f9d1b2a9d8b1c2a3d4e5f6g",
      "name": "John Doe",
      "email": "john@example.com",
      "emailVerified": false,
      "createdAt": "2026-05-03T10:00:00.000Z",
      "updatedAt": "2026-05-03T10:00:00.000Z"
    },
    "session": {
      "id": "session_abc123",
      "userId": "5f9d1b2a9d8b1c2a3d4e5f6g",
      "expiresAt": "2026-05-10T10:00:00.000Z"
    }
  }
}
```

### 1.2 Send Verification OTP
**Endpoint:** `POST /email-otp/send-verification-otp`
- **Description:** Sends an email verification OTP to the user.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/email-otp/send-verification-otp" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com"
  }'
```

**Response Example (200 OK):**
```json
{
  "data": {
    "status": true
  }
}
```

### 1.3 Verify Email OTP
**Endpoint:** `POST /verify-email-otp`
- **Description:** Verifies the OTP sent to the user's email.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/verify-email-otp" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "otp": "123456"
  }'
```

**Response Example (200 OK):**
```json
{
  "data": {
    "status": true
  }
}
```

### 1.4 Sign In
**Endpoint:** `POST /sign-in/email`
- **Description:** Authenticates a user and establishes a session.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "SecurePassword123!",
    "rememberMe": true
  }'
```

**Response Example (200 OK):**
```json
{
  "session": {
    "user": {
      "id": "5f9d1b2a9d8b1c2a3d4e5f6g",
      "name": "John Doe",
      "email": "john@example.com",
      "emailVerified": true,
      "role": "user"
    },
    "session": {
      "id": "session_xyz789",
      "userId": "5f9d1b2a9d8b1c2a3d4e5f6g",
      "expiresAt": "2026-05-10T10:00:00.000Z"
    }
  }
}
```

### 1.5 Sign Out
**Endpoint:** `POST /sign-out`
- **Description:** Logs out the user and destroys the current session.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/sign-out" \
  -H "Authorization: Bearer session_xyz789"
```

**Response Example (200 OK):**
```json
{
  "data": {
    "success": true
  }
}
```

### 1.6 Change Password
**Endpoint:** `POST /change-password`
- **Description:** Updates the password for an authenticated user.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/change-password" \
  -H "Authorization: Bearer session_xyz789" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "SecurePassword123!",
    "newPassword": "NewSecurePassword456!",
    "revokeOtherSessions": true
  }'
```

**Response Example (200 OK):**
```json
{
  "data": {
    "status": true
  }
}
```

### 1.7 Forget Password Flow
#### Step 1: Send OTP
**Endpoint:** `POST /forget-password/email-otp`
**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/forget-password/email-otp" \
  -H "Content-Type: application/json" \
  -d '{"email": "john@example.com"}'
```

#### Step 2: Check OTP
**Endpoint:** `POST /email-otp/check-verification-otp`
**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/email-otp/check-verification-otp" \
  -H "Content-Type: application/json" \
  -d '{"email": "john@example.com", "otp": "123456"}'
```

#### Step 3: Reset Password
**Endpoint:** `POST /email-otp/reset-password`
**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/email-otp/reset-password" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "otp": "123456",
    "password": "BrandNewPassword789!"
  }'
```

**Response Example (for all 3 steps):**
```json
{
  "data": {
    "status": true
  }
}
```

### 1.8 Delete Account
**Endpoint:** `POST /delete-account`
- **Description:** Permanently deletes the authenticated user's account.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/delete-account" \
  -H "Authorization: Bearer session_xyz789" \
  -H "Content-Type: application/json" \
  -d '{
    "password": "BrandNewPassword789!"
  }'
```

**Response Example (200 OK):**
```json
{
  "data": {
    "status": true
  }
}
```

### 1.9 Get Current User
**Endpoint:** `GET /me`
- **Description:** Retrieves the profile of the currently authenticated user.

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/me" \
  -H "Authorization: Bearer session_xyz789"
```

**Response Example (200 OK):**
```json
{
  "data": {
    "id": "5f9d1b2a9d8b1c2a3d4e5f6g",
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "image": "https://res.cloudinary.com/...",
    "role": "user",
    "emailVerified": true
  }
}
```

### 1.10 Update Account Info
**Endpoint:** `POST /update-account-info`
- **Description:** Updates basic account details.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/update-account-info" \
  -H "Authorization: Bearer session_xyz789" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Johnathon Doe",
    "phone": "+19876543210"
  }'
```

**Response Example (200 OK):**
```json
{
  "data": {
    "id": "5f9d1b2a9d8b1c2a3d4e5f6g",
    "name": "Johnathon Doe",
    "email": "john@example.com",
    "phone": "+19876543210"
  }
}
```

### 1.11 Profile Photo Management
#### Upload Photo
**Endpoint:** `POST /account/upload-profile-photo`

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/account/upload-profile-photo" \
  -H "Authorization: Bearer session_xyz789" \
  -F "image=@/path/to/profile.jpg"
```

**Response Example (200 OK):**
```json
{
  "data": {
    "image": "https://res.cloudinary.com/demo/image/upload/v1/profiles/user_id",
    "publicId": "profiles/user_id",
    "width": 800,
    "height": 800,
    "format": "jpg"
  }
}
```

#### Remove Photo
**Endpoint:** `DELETE /account/remove-profile-photo`

**cURL Example:**
```bash
curl -X DELETE "http://localhost:5000/api/account/remove-profile-photo" \
  -H "Authorization: Bearer session_xyz789"
```

**Response Example (200 OK):**
```json
{
  "data": {
    "image": null,
    "deleted": true
  }
}
```

---

## 2. Admin Operations
**Source:** `src/routes/user/admin.ts`
**Note:** All admin endpoints require specific Better Auth permissions and a valid administrative session.

### 2.1 Create Role-based User
**Endpoint:** `POST /admin/create-user`
- **Permissions Required:** `user: ["create"]`

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/admin/create-user" \
  -H "Authorization: Bearer admin_session_token" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "trainer",
    "email": "trainer@example.com",
    "password": "TrainerPassword123!",
    "name": "Jane Trainer",
    "accountType": "master",
    "phone": "+1234567890",
    "newsletter": false
  }'
```

**Response Example (201 Created):**
```json
{
  "data": {
    "id": "6a9d1b2a9d8b1c2a3d4e5f6h",
    "name": "Jane Trainer",
    "email": "trainer@example.com",
    "role": "trainer",
    "createdAt": "2026-05-03T10:00:00.000Z"
  }
}
```

### 2.2 List Users
**Endpoint:** `GET /admin/list-user/all`
- **Permissions Required:** `user: ["list"]`

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/admin/list-user/all?role=user&page=1&limit=10" \
  -H "Authorization: Bearer admin_session_token"
```

**Response Example (200 OK):**
```json
{
  "data": {
    "users": [
      {
        "id": "5f9d1b2a9d8b1c2a3d4e5f6g",
        "name": "John Doe",
        "email": "john@example.com",
        "emailVerified": true,
        "role": "user",
        "banned": false,
        "phone": "+1234567890",
        "accountType": "free",
        "createdAt": "2026-05-03T10:00:00.000Z",
        "updatedAt": "2026-05-03T10:00:00.000Z",
        "traineeName": "Trainer Bob",
        "traineeEmail": "bob@example.com",
        "traineeId": "trainer_id_123"
      }
    ],
    "meta": {
      "page": 1,
      "offset": 0,
      "limit": 10,
      "total": 50,
      "totalPages": 5,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### 2.3 Set User Role
**Endpoint:** `POST /admin/set-user-role`
- **Permissions Required:** `user: ["update"]`

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/admin/set-user-role" \
  -H "Authorization: Bearer admin_session_token" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "5f9d1b2a9d8b1c2a3d4e5f6g",
    "role": "admin"
  }'
```

**Response Example (200 OK):**
```json
{
  "data": {
    "status": true
  }
}
```

### 2.4 Ban / Unban User
#### Ban User
**Endpoint:** `POST /admin/ban-user`
**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/admin/ban-user" \
  -H "Authorization: Bearer admin_session_token" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "5f9d1b2a9d8b1c2a3d4e5f6g",
    "banReason": "Violation of terms",
    "banExpiresIn": "7d"
  }'
```

#### Unban User
**Endpoint:** `POST /admin/unban-user`
**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/admin/unban-user" \
  -H "Authorization: Bearer admin_session_token" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "5f9d1b2a9d8b1c2a3d4e5f6g"
  }'
```

**Response Example (200 OK):**
```json
{
  "data": {
    "status": true
  }
}
```

### 2.5 Delete User(s)
#### Single Delete
**Endpoint:** `POST /admin/delete-user`
**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/admin/delete-user" \
  -H "Authorization: Bearer admin_session_token" \
  -H "Content-Type: application/json" \
  -d '{"userId": "5f9d1b2a9d8b1c2a3d4e5f6g"}'
```

#### Bulk Delete
**Endpoint:** `POST /admin/delete-users`
**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/admin/delete-users" \
  -H "Authorization: Bearer admin_session_token" \
  -H "Content-Type: application/json" \
  -d '{"userIds": ["user_1", "user_2"]}'
```

**Response Example (Bulk - 200 OK):**
```json
{
  "data": {
    "success": ["user_1"],
    "failed": [
      {
        "userId": "user_2",
        "error": "User not found"
      }
    ]
  }
}
```

### 2.6 Admin Profile Management
**Permissions Required:** `profile: ["manage"]`

#### List Profiles for User
**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/admin/profiles?userId=5f9d1b2a9d8b1c2a3d4e5f6g" \
  -H "Authorization: Bearer admin_session_token"
```

#### Create Profile for User
**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/admin/profiles" \
  -H "Authorization: Bearer admin_session_token" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "5f9d1b2a9d8b1c2a3d4e5f6g",
    "name": "Child Profile",
    "avatar": "https://example.com/avatar.png"
  }'
```

**Response Example (201 Created):**
```json
{
  "data": {
    "_id": "profile_123",
    "userId": "5f9d1b2a9d8b1c2a3d4e5f6g",
    "name": "Child Profile",
    "avatar": "https://example.com/avatar.png",
    "isDefault": false
  }
}
```

#### Update / Delete
**cURL Example (Update):**
```bash
curl -X PATCH "http://localhost:5000/api/admin/profiles/profile_123" \
  -H "Authorization: Bearer admin_session_token" \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Profile"}'
```

**cURL Example (Delete):**
```bash
curl -X DELETE "http://localhost:5000/api/admin/profiles/profile_123" \
  -H "Authorization: Bearer admin_session_token"
```

---

## 3. User Profiles Management
**Source:** `src/routes/user/profiles.ts`
**Note:** These endpoints are exclusive to accounts with the `user` role. Users can have a maximum of 5 profiles.

### 3.1 List My Profiles
**Endpoint:** `GET /profiles`

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/profiles" \
  -H "Authorization: Bearer user_session_token"
```

**Response Example (200 OK):**
```json
{
  "data": {
    "profiles": [
      {
        "_id": "profile_123",
        "userId": "5f9d1b2a9d8b1c2a3d4e5f6g",
        "name": "My Profile",
        "avatar": "",
        "isDefault": true,
        "createdAt": "2026-05-03T10:00:00.000Z"
      }
    ],
    "activeProfileId": "profile_123"
  }
}
```

### 3.2 Create My Profile
**Endpoint:** `POST /profiles`

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/profiles" \
  -H "Authorization: Bearer user_session_token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Gaming Profile",
    "avatar": "https://example.com/game.png"
  }'
```

**Response Example (201 Created):**
```json
{
  "data": {
    "_id": "profile_456",
    "userId": "5f9d1b2a9d8b1c2a3d4e5f6g",
    "name": "Gaming Profile",
    "avatar": "https://example.com/game.png",
    "isDefault": false
  }
}
```

### 3.3 Update My Profile
**Endpoint:** `PATCH /profiles/:profileId`

**cURL Example:**
```bash
curl -X PATCH "http://localhost:5000/api/profiles/profile_456" \
  -H "Authorization: Bearer user_session_token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Gaming Profile Name"
  }'
```

**Response Example (200 OK):**
```json
{
  "data": {
    "_id": "profile_456",
    "userId": "5f9d1b2a9d8b1c2a3d4e5f6g",
    "name": "New Gaming Profile Name",
    "avatar": "https://example.com/game.png",
    "isDefault": false
  }
}
```

### 3.4 Delete My Profile
**Endpoint:** `DELETE /profiles/:profileId`

**cURL Example:**
```bash
curl -X DELETE "http://localhost:5000/api/profiles/profile_456" \
  -H "Authorization: Bearer user_session_token"
```

**Response Example (200 OK):**
```json
{
  "data": {
    "deleted": true
  }
}
```

### 3.5 Switch Profile
**Endpoint:** `POST /profiles/switch`

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/profiles/switch" \
  -H "Authorization: Bearer user_session_token" \
  -H "Content-Type: application/json" \
  -d '{
    "profileId": "profile_123"
  }'
```

**Response Example (200 OK):**
```json
{
  "data": {
    "activeProfileId": "profile_123"
  }
}
```

---

## 4. Tags Management
**Source:** `src/routes/tags/tags.ts`
**Note:** These endpoints are primarily for administrators to manage video/content tags.

### 4.1 Create Tag
**Endpoint:** `POST /admin/create-tags`
- **Permissions Required:** `tag: ["create"]`
- **Description:** Creates a new content tag. The slug is automatically generated from the name (lowercase, spaces replaced by hyphens).

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/admin/create-tags" \
  -H "Authorization: Bearer admin_session_token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Clinical Practice"
  }'
```

**Response Example (201 Created):**
```json
{
  "success": true,
  "message": "Tag created",
  "data": {
    "_id": "69f1a2b3c4d5e6f7g8h9i0j1",
    "name": "Clinical Practice",
    "slug": "clinical-practice",
    "active": true,
    "createdBy": "69ea8ad06f8ba4f6a0f6bf28",
    "createdAt": "2026-05-03T12:00:00.000Z",
    "updatedAt": "2026-05-03T12:00:00.000Z"
  }
}
```

### 4.2 List All Tags
**Endpoint:** `GET /admin/tags`
- **Permissions Required:** `tag: ["view"]`
- **Description:** Retrieves all tags, including inactive ones, sorted by most recently updated.

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/admin/tags" \
  -H "Authorization: Bearer admin_session_token"
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Tags fetched",
  "data": [
    {
      "_id": "69f1a2b3c4d5e6f7g8h9i0j1",
      "name": "Clinical Practice",
      "slug": "clinical-practice",
      "active": true,
      "createdBy": "69ea8ad06f8ba4f6a0f6bf28",
      "createdAt": "2026-05-03T12:00:00.000Z",
      "updatedAt": "2026-05-03T12:00:00.000Z"
    }
  ]
}
```

### 4.3 Deactivate Tag
**Endpoint:** `PUT /admin/tags/:id/deactivate`
- **Permissions Required:** `tag: ["delete"]`
- **Description:** Soft-deletes a tag by setting `active` to `false`.

**cURL Example:**
```bash
curl -X PUT "http://localhost:5000/api/admin/tags/69f1a2b3c4d5e6f7g8h9i0j1/deactivate" \
  -H "Authorization: Bearer admin_session_token"
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Tag deactivated",
  "data": {
    "_id": "69f1a2b3c4d5e6f7g8h9i0j1",
    "name": "Clinical Practice",
    "slug": "clinical-practice",
    "active": false,
    "deletedAt": "2026-05-03T12:05:00.000Z"
  }
}
```

### 4.4 Activate Tag
**Endpoint:** `PUT /admin/tags/:id/activate`
- **Permissions Required:** `tag: ["update"]`
- **Description:** Reactivates a soft-deleted tag.

**cURL Example:**
```bash
curl -X PUT "http://localhost:5000/api/admin/tags/69f1a2b3c4d5e6f7g8h9i0j1/activate" \
  -H "Authorization: Bearer admin_session_token"
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Tag activated",
  "data": {
    "_id": "69f1a2b3c4d5e6f7g8h9i0j1",
    "name": "Clinical Practice",
    "slug": "clinical-practice",
    "active": true
  }
}
```

### 4.5 Hard Delete Tag
**Endpoint:** `DELETE /admin/tags/:id`
- **Permissions Required:** `tag: ["delete"]`
- **Description:** Permanently removes a tag from the database.

**cURL Example:**
```bash
curl -X DELETE "http://localhost:5000/api/admin/tags/69f1a2b3c4d5e6f7g8h9i0j1" \
  -H "Authorization: Bearer admin_session_token"
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Tag hard deleted",
  "data": {
    "_id": "69f1a2b3c4d5e6f7g8h9i0j1",
    "name": "Clinical Practice"
  }
}
```

---

## 5. Short Videos Management
**Sources:** `src/routes/content-management/short-videos.ts`, `src/routes/content-management/short-videos-v1.ts`

### 5.0 Status Lifecycle & Role Permissions

#### Who Can Create
| Role | Can Create? | Initial Status Options |
|------|-------------|----------------------|
| Admin | ✅ | `draft`, `pending`, `published`, `rejected` |
| Trainer | ✅ | `draft`, `pending` only |
| Trainee | ✅ | `draft`, `pending` only |
| User | ❌ | — |

#### Status Transitions
```
Trainer / Trainee:
  draft ──[creator]──> pending   (submit for admin review)
  pending ──[creator]──> draft   (pull back to draft)

Admin only:
  pending ──[admin]──> published  (approve)
  pending ──[admin]──> rejected   (reject with reason)
  published ──[admin]──> rejected (unpublish)
  any ──[admin]──> any            (admin can set any status)
```

#### Permission Summary
| Permission | Granted To | Controls |
|---|---|---|
| `shortVideo:create` | Admin, Trainer, Trainee | Create new videos |
| `shortVideo:view` | All authenticated | View published; owner/admin sees own drafts |
| `shortVideo:update` | Admin, Trainer, Trainee | Edit metadata, resources, video file |
| `shortVideo:delete` | Admin, Trainer, Trainee | Delete own videos; Admin deletes any |
| `shortVideoStatus:view` | Admin, Trainer, Trainee | Access management listing (all statuses) |
| `shortVideoStatus:create` | Admin only | Publish or reject videos |

> **Note (V1 flow):** In the V1 two-phase upload flow, the `POST /v1/short-videos/:id/publish` endpoint lets the **owner or admin** publish directly from `draft` after the video file has been uploaded — bypassing the `pending` step. Use the V0 `change-status` endpoint if the review/approval workflow is required.

---

### 5.1 Change Video Status (Review Flow)
**Endpoint:** `PUT /admin/change-status-short-video/:id`
- **Description:** The primary endpoint for the approval workflow.
  - **Trainer / Trainee (own videos only):** may set `draft` or `pending`.
  - **Admin (any video):** may set any status — `draft`, `pending`, `published`, or `rejected`.
  - Admin notifies the video owner via push notification when publishing or rejecting.

**cURL Example — Trainer submits for review:**
```bash
curl -X PUT "http://localhost:5000/api/admin/change-status-short-video/69f2a3b4c5d6e7f8g9h0i1j2" \
  -H "Authorization: Bearer TRAINER_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "pending"}'
```

**cURL Example — Admin approves:**
```bash
curl -X PUT "http://localhost:5000/api/admin/change-status-short-video/69f2a3b4c5d6e7f8g9h0i1j2" \
  -H "Authorization: Bearer ADMIN_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "published"}'
```

**cURL Example — Admin rejects:**
```bash
curl -X PUT "http://localhost:5000/api/admin/change-status-short-video/69f2a3b4c5d6e7f8g9h0i1j2" \
  -H "Authorization: Bearer ADMIN_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "rejected", "rejectReason": "Content does not meet guidelines"}'
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Short video status updated",
  "data": {
    "_id": "69f2a3b4c5d6e7f8g9h0i1j2",
    "status": "published"
  }
}
```

---

### 5.2 Create Short Video Shell — V1 (Two-Phase Upload)
**Endpoint:** `POST /v1/short-videos`
- **Permissions Required:** `shortVideo: ["create"]`
- **Description:** Phase 1 of the V1 upload flow. Creates a `draft` shell record with metadata only — no video file yet. Title and description are required.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/v1/short-videos" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Intro to Clinical Research",
    "description": "A short overview of modern clinical trials.",
    "tags": ["clinical", "research"],
    "accessLevel": "free",
    "visibility": "all"
  }'
```

**Response Example (201 Created):**
```json
{
  "success": true,
  "message": "Short video shell created",
  "data": {
    "_id": "69f2a3b4c5d6e7f8g9h0i1j2",
    "title": "Intro to Clinical Research",
    "status": "draft",
    "videoReady": false
  }
}
```

### 5.3 Get Signed Upload URL — V1
**Endpoint:** `POST /v1/short-videos/:id/signed-upload-url`
- **Permissions Required:** Owner or Admin.
- **Description:** Phase 2. Generates signed parameters for a direct frontend-to-Cloudinary upload. Blocked if status is `published`.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/v1/short-videos/69f2a3b4c5d6e7f8g9h0i1j2/signed-upload-url" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://api.cloudinary.com/v1_1/your-cloud/video/upload",
    "fields": {
      "api_key": "your_key",
      "timestamp": 123456789,
      "signature": "hmac_signature",
      "public_id": "short-videos/69f2a3b4c5d6e7f8g9h0i1j2",
      "notification_url": "http://localhost:5000/api/v1/webhooks/cloudinary/upload-complete"
    }
  }
}
```

### 5.4 Check Upload Status — V1 (Polling)
**Endpoint:** `GET /v1/short-videos/:id/status`
- **Permissions Required:** Owner or Admin.
- **Description:** Lightweight polling endpoint. The frontend calls this after upload to detect when the Cloudinary webhook has processed the video (`videoReady: true`).

**Response Example:**
```json
{
  "success": true,
  "data": {
    "status": "draft",
    "videoReady": true,
    "durationSeconds": 45.5,
    "subtitleStatus": "pending"
  }
}
```

### 5.5 Publish Short Video — V1
**Endpoint:** `POST /v1/short-videos/:id/publish`
- **Permissions Required:** Owner or Admin.
- **Description:** Phase 3. Directly transitions status from `draft` → `published`. Requires `cloudinaryId` set (video uploaded), `title`, `description`, and at least one tag. Use this for immediate publish without the admin review step. For the review/approval workflow use `PUT /admin/change-status-short-video/:id` instead.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/v1/short-videos/69f2a3b4c5d6e7f8g9h0i1j2/publish" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Short video published",
  "data": {
    "_id": "69f2a3b4c5d6e7f8g9h0i1j2",
    "status": "published"
  }
}
```

---

### 5.6 Management Endpoints (V0)
**Source:** `src/routes/content-management/short-videos.ts`

#### 5.6.1 List Videos (Management Dashboard)
**Endpoint:** `GET /short-videos`
- **Permissions Required:** `shortVideoStatus: ["view"]`
- **Description:** Paginated list for admin/trainer/trainee dashboard. Supports filtering and search.
- **Query Parameters:**
  - `page`: Page number (default: 1)
  - `limit`: Items per page (default: 10)
  - `status`: `draft`, `pending`, `published`, or `rejected`
  - `tags`: Comma-separated tag slugs
  - `q`: Search string (searches title/description)
  - `sortBy`: `createdAt`, `title`, or `tags`
  - `order`: `asc` or `desc`

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/short-videos?status=pending&limit=5&q=Intro" \
  -H "Authorization: Bearer ADMIN_SESSION_TOKEN"
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Short videos fetched",
  "data": [
    {
      "_id": "69f2a3b4c5d6e7f8g9h0i1j2",
      "title": "Intro to Research",
      "description": "Basic concepts...",
      "tags": ["clinical", "research"],
      "status": "pending",
      "thumbnailUrl": "https://res.cloudinary.com/...",
      "durationSeconds": 120.5,
      "createdAt": "2026-05-03T10:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 5,
    "total": 12,
    "hasNext": true
  }
}
```

#### 5.6.2 List Published Videos (End-User Feed)
**Endpoint:** `GET /short-videos/published-videos`
- **Description:** Paginated list of published videos visible to the current user. Automatically filters by `visibility` and `accessLevel`.

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/short-videos/published-videos?page=1&limit=10" \
  -H "Authorization: Bearer USER_SESSION_TOKEN"
```

#### 5.6.3 Get Single Video Details
**Endpoint:** `GET /short-videos/:id`
- **Description:** Retrieves full details for a video, including resources and subtitle status.

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/short-videos/69f2a3b4c5d6e7f8g9h0i1j2" \
  -H "Authorization: Bearer USER_SESSION_TOKEN"
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Short video fetched",
  "data": {
    "_id": "69f2a3b4c5d6e7f8g9h0i1j2",
    "title": "Intro to Research",
    "cloudinaryUrl": "https://res.cloudinary.com/.../auto.m3u8",
    "resources": [
      {
        "_id": "res_123",
        "name": "Lecture Notes",
        "url": "https://res.cloudinary.com/.../notes.pdf"
      }
    ],
    "subtitle_status": "completed",
    "subtitles": [...]
  }
}
```

#### 5.6.4 Update Video Metadata
**Endpoint:** `PUT /short-videos/:id`
- **Permissions Required:** `shortVideo: ["update"]` (Owner or Admin)
- **Description:** Updates video details. If `cloudinaryId` is changed, the subtitle pipeline is reset.

**cURL Example:**
```bash
curl -X PUT "http://localhost:5000/api/short-videos/69f2a3b4c5d6e7f8g9h0i1j2" \
  -H "Authorization: Bearer OWNER_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Title",
    "accessLevel": "master"
  }'
```

#### 5.6.5 Track Watch Progress
**Endpoint:** `POST /short-videos/:id/progress`
- **Description:** Saves the current watch position. 
- **Body:** `{ "watchedSeconds": number }`

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/short-videos/69f2a3b4c5d6e7f8g9h0i1j2/progress" \
  -H "Authorization: Bearer USER_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"watchedSeconds": 45}'
```

#### 5.6.6 Add Resources
**Endpoint:** `POST /short-videos/:id/resources`
- **Description:** Attach files or external URLs to the video. Supports `multipart/form-data` for file uploads or `application/json` for URL entries.

**cURL Example (File Upload):**
```bash
curl -X POST "http://localhost:5000/api/short-videos/69f2a3b4c5d6e7f8g9h0i1j2/resources" \
  -H "Authorization: Bearer OWNER_SESSION_TOKEN" \
  -F "files=@/path/to/notes.pdf" \
  -F "names=[\"Lecture Notes\"]"
```

**cURL Example (URL Entry):**
```bash
curl -X POST "http://localhost:5000/api/short-videos/69f2a3b4c5d6e7f8g9h0i1j2/resources" \
  -H "Authorization: Bearer OWNER_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resources": [{"name": "External Link", "url": "https://example.com"}]}'
```

#### 5.6.7 Delete Video
**Endpoint:** `DELETE /short-videos/:id`
- **Permissions Required:** `shortVideo: ["delete"]` (Owner or Admin)

**cURL Example:**
```bash
curl -X DELETE "http://localhost:5000/api/short-videos/69f2a3b4c5d6e7f8g9h0i1j2" \
  -H "Authorization: Bearer OWNER_SESSION_TOKEN"
```

#### 5.6.8 Remove Video File Only
**Endpoint:** `DELETE /short-videos/:id/video`
- **Permissions Required:** Owner or Admin.
- **Description:** Removes the Cloudinary video asset but keeps the metadata record intact. Useful for re-uploading a new video to the same record.

**cURL Example:**
```bash
curl -X DELETE "http://localhost:5000/api/short-videos/69f2a3b4c5d6e7f8g9h0i1j2/video" \
  -H "Authorization: Bearer OWNER_SESSION_TOKEN"
```

#### 5.6.9 Get Watch Progress
**Endpoint:** `GET /short-videos/:id/progress`
- **Description:** Returns the current watch status for the authenticated user (or active profile).

**cURL Example:**
```bash
curl -X GET "http://localhost:5000/api/short-videos/69f2a3b4c5d6e7f8g9h0i1j2/progress" \
  -H "Authorization: Bearer USER_SESSION_TOKEN"
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "data": {
    "watchedSeconds": 45,
    "completed": false,
    "percentWatched": 37.5
  }
}
```

#### 5.6.10 Remove Resource
**Endpoint:** `DELETE /short-videos/:id/resources/:resourceId`
- **Permissions Required:** Owner or Admin.
- **Description:** Removes a specific resource from the video. If the resource was an uploaded file, it also deletes the asset from Cloudinary.

**cURL Example:**
```bash
curl -X DELETE "http://localhost:5000/api/short-videos/69f2a3b4c5d6e7f8g9h0i1j2/resources/res_123" \
  -H "Authorization: Bearer OWNER_SESSION_TOKEN"
```

#### 5.6.11 Retry Subtitles
**Endpoint:** `POST /short-videos/:id/retry-subtitles`
- **Description:** Manually re-triggers the background captioning pipeline. Used when the initial automatic generation failed.

**cURL Example:**
```bash
curl -X POST "http://localhost:5000/api/short-videos/69f2a3b4c5d6e7f8g9h0i1j2/retry-subtitles" \
  -H "Authorization: Bearer OWNER_SESSION_TOKEN"
```

---

### 5.7 Webhook — Cloudinary Upload Complete
**Endpoint:** `POST /v1/webhooks/cloudinary/upload-complete`
- **Type:** Secure Server-to-Server Webhook
- **Security**: Verifies `X-Cld-Signature` and `X-Cld-Timestamp` headers using Cloudinary API Secret.

**Typical Payload (sent by Cloudinary):**
```json
{
  "notification_type": "upload",
  "public_id": "short-videos/69f2a3b4c5d6e7f8g9h0i1j2",
  "secure_url": "https://res.cloudinary.com/...",
  "duration": 120.5
}
```

**Backend Response (200 OK):**
```json
{
  "success": true,
  "message": "Upload webhook processed",
  "data": {
    "shortVideoId": "69f2a3b4c5d6e7f8g9h0i1j2",
    "publicId": "short-videos/69f2a3b4c5d6e7f8g9h0i1j2"
  }
}
```
