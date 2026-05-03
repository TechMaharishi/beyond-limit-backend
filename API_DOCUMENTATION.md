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
