# Beyond Limit API Documentation

## Table of Contents
- [Environment Setup](#environment-setup)
- [Credentials](#credentials)
- [API Endpoints](#api-endpoints)
  - [Authentication](#authentication)
  - [User Management](#user-management)
  - [Admin Operations](#admin-operations)
- [Demo User Credentials](#demo-user-credentials)

## Environment Setup

Create a `.env` file in your project root with the following variables:

```env
PORT=5000
BETTER_AUTH_URL=http://localhost:5000
NODE_ENV=development
LOG_LEVEL=debug
MONGO_URI=mongodb://localhost:27017/beyond-limit
BETTER_AUTH_SECRET=RrX0FpM9nmDf9qCRQKmlr3occ1DrRrw6
CLIENT_ORIGIN=http://localhost:5173
EMAIL=kwd.vishalkumar@gmail.com
EMAIL_PASS=rcmn xesy jwdt frjr
SUPER_ADMIN_USER_ID=68cedefdef3cd05b41f804dd
CLOUDINARY_URL=cloudinary://168815538448934:9XkAYOw22WdOtRNG_MFn1a_Vitw@dmaygfxec
CLOUD_NAME=9XkAYOw22WdOtRNG_MFn1a_Vitw
CLOUDINARY_API_KEY=168815538448934
CLOUDINARY_API_SECRET=dmaygfxec
```

## Credentials

⚠️ **Note: These credentials are for testing purposes only**

### Cloudinary Credentials
- **Email:** `jhnbsomers+v6rmy@gmail.com`
- **Password:** `jhnbsomers+v6rmy@gmail.coM`

### MongoDB Credentials
- **Email:** `hoheji5695@bitfami.com`
- **Password:** `VishalKumarSahu`
- **Database User ID:** `hoheji5695_db_user`
- **Database Password:** `P9aAmd3olKjqUNLy`
- **Connection URL:** `mongodb+srv://hoheji5695_db_user:P9aAmd3olKjqUNLy@cluster0.km7lpxm.mongodb.net/beyond-limit`

## API Endpoints

### Authentication

#### Create Account
```http
POST {{baseURL}}/api/sign-up/email
Content-Type: application/json

{
  "name": "string",
  "email": "string",
  "password": "string"
}
```

#### Sign In
```http
POST {{baseURL}}/api/sign-in/email
Content-Type: application/json

{
  "name": "string",
  "email": "string",
  "password": "string"
}
```

#### Sign Out
```http
POST {{baseURL}}/api/sign-out
```

#### Request Password Reset
```http
POST {{baseURL}}/api/request-password-reset
Content-Type: application/json

{
  "email": "string"
}
```

**Note:** A reset link will be sent to the provided email. Password reset page can be implemented using React or Server-Side Rendering (EJS). SSR is recommended.

#### Reset Password
```http
POST {{baseURL}}/api/reset-password
Content-Type: application/json

{
  "token": "string",
  "newPassword": "string"
}
```

#### Change Password
```http
POST {{baseURL}}/api/change-password
Content-Type: application/json

{
  "newPassword": "string",
  "currentPassword": "string",
  "revokeOtherSessions": "boolean"
}
```

### User Management

#### Get User Profile
```http
GET {{baseURL}}/api/me
```

**Response:**
- Name
- Email
- Role
- Email Verified Status

#### Delete Account
```http
POST {{baseURL}}/delete-account
Content-Type: application/json

{
  "password": "string"
}
```

#### Verify Account Deletion
```http
POST {{baseURL}}/delete-account/verification
Content-Type: application/json

{
  "token": "string"
}
```

**Note:** Admin accounts cannot be deleted.

### Admin Operations

#### Create Role-Based Account
```http
POST {{baseURL}}/api/admin/create-user
Content-Type: application/json

{
  "email": "string",
  "password": "string",
  "name": "string",
  "role": "string"
}
```

**Note:** 
- Only admins can create accounts
- A confirmation email will be sent to the new user
- Hierarchy-based account creation is implemented

#### List All Users
```http
GET {{baseURL}}/api/admin/list-user
```

**Note:** Only accessible by admins

#### Set User Role
```http
POST {{baseURL}}/api/admin/set-user-role
Content-Type: application/json

{
  "userId": "string",
  "role": "string"
}
```

#### Reset User Password
```http
POST {{baseURL}}/api/admin/reset-user-password
Content-Type: application/json

{
  "newPassword": "string",
  "userId": "string"
}
```

#### Ban User
```http
POST {{baseURL}}/api/admin/ban-user
Content-Type: application/json

{
  "userId": "string"
}
```

#### Unban User
```http
POST {{baseURL}}/api/admin/unban-user
Content-Type: application/json

{
  "userId": "string"
}
```

#### Delete User
```http
POST {{baseURL}}/api/admin/delete-user
Content-Type: application/json

{
  "userId": "string"
}
```

**Note:** Only admins can perform ban/unban/delete operations

## Demo User Credentials

### Admin
- **Email:** `vis.koolboy29@gmail.com`
- **Password:** `Vishal@29`

### Other Roles
- **Trainer:** (Credentials to be provided)
- **Employee:** (Credentials to be provided)
- **User:** (Credentials to be provided)

## Role Hierarchy

The system implements a role-based hierarchy:
1. **Admin** - Full system access
2. **Trainer** - Limited administrative access
3. **Employee** - Standard user with additional permissions
4. **User** - Basic access level

## Development Notes

- **Base URL:** `http://localhost:5000` (development)
- **Client Origin:** `http://localhost:5173`
- **Database:** MongoDB with connection pooling
- **File Storage:** Cloudinary for media uploads
- **Authentication:** Better-Auth implementation
- **Email Service:** SMTP configuration included

## Security Considerations

- All admin operations require proper authentication
- Password reset tokens are time-limited
- Session management with optional revocation
- Role-based access control implemented
- Email verification required for account creation

---

**Last Updated:** September 2025  
**Version:** 1.0.0