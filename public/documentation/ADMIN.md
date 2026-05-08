# Admin Management API Specification

## 1. API Overview
- **Domain Context**: Global administration and platform governance. Includes user lifecycle control, role assignment, banning, and administrative profile management.
- **Architectural Style**: RESTful API.
- **Base URL Conventions**: `/api/admin`

## 2. Role-Based Access Control (RBAC) Model
Strict permission-based access control leveraging Better Auth dynamic permissions.

### Role Hierarchy & Permissions Matrix
- **Super Admin**: Defined by `adminUserIds` in config. Overrides all checks.
- **Admin**: Has `ban`, `create`, `list`, `delete`, `reset-password`, `update` on `user` resource.
- **Trainer**: Limited user list and ban capabilities.
- **Trainee/User**: Restricted to public/own resource visibility.

| Endpoint | Method | Required Permission Node | Context |
|----------|--------|--------------------------|---------|
| `/admin/create-user` | `POST` | `user: ["create"]` | Create user with role |
| `/admin/list-user/all`| `GET` | `user: ["list"]` | Full user list + search |
| `/admin/set-user-role`| `POST` | `user: ["update"]` | Change role |
| `/admin/ban-user` | `POST` | `user: ["ban"]` | Temporary/Permanent ban |
| `/admin/delete-user` | `POST` | `user: ["delete"]` | Individual user deletion |
| `/admin/delete-users` | `POST` | `user: ["delete"]` | Bulk delete (max 100) |
| `/admin/profiles` | `GET` | `profile: ["manage"]` | View any user's profiles|

## 3. Endpoint Specifications

### 3.1. List Users (Paginated)
- **Route**: `GET /admin/list-user/all`
- **Purpose**: High-performance user lookup with filtering.
- **Query Parameters**:
  - `role`: Filter by `admin`, `trainer`, `trainee`, `user`.
  - `search`: Search string (email/name).
  - `field`: `email` or `name` (default: `name`).
  - `sortBy`: `createdAt`, `updatedAt`, `name`, `email`.
  - `sortDirection`: `asc` or `desc`.
  - `page` / `limit`: Pagination controls.

### 3.2. Set User Role
- **Route**: `POST /admin/set-user-role`
- **Purpose**: Updates a user's role and handles side effects.
- **Business Logic**:
  - If a user is promoted *to* `user` role, a default profile is ensured.
  - If a user is moved *from* `user` role, active profiles are cleared from sessions.

### 3.3. Ban User
- **Route**: `POST /admin/ban-user`
- **Payload**:
  - `userId` (string, required)
  - `banReason` (string, optional)
  - `banExpiresIn` (string, optional): Format `10m`, `2h`, `7d`.

## 4. Validation and Logic Flows
1. **Permission Check**: Every endpoint invokes `auth.api.userHasPermission`.
2. **Bulk Operations**: `/admin/delete-users` uses concurrency-limited `Promise.allSettled` (concurrency: 10) to prevent upstream service exhaustion.
3. **Target Validation**: Admin operations on profiles verify that the target account role is `user` before allowing management.
4. **Deletion Protection**: Better Auth `beforeDelete` hook prevents deletion of any account with the `admin` role or listed in `adminUserIds`.

## 5. Security Considerations
- **Concurrency**: Bulk deletion is capped at 100 IDs per request.
- **Sanitization**: `userId` strings are validated for format and existence via MongoDB `ObjectId` validation.
- **Audit Logging**: State changes (Role, Ban, Delete) are logged implicitly in the Better Auth database via `dash` plugin activity tracking.

## 6. Performance & Scalability
- **Pagination**: Compulsory for large datasets via `offset` and `limit`.
- **Query Optimization**: `ListUser` performs a single DB join against `ClinicalAssignment` for relevant user subsets to display trainee assignments.
- **Memory**: `lean()` queries are used for all admin lookups.
