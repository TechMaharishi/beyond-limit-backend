# Clinical Assignment API Specification

## 1. API Overview
- **Domain Context**: Orchestrates the relationship between learners (users/profiles) and clinicians (trainees/trainers). This system manages the "Clinical Link," allowing professional oversight of learner progress.
- **Architectural Style**: RESTful API.
- **Base URL Conventions**: `/api`.
- **Versioning Strategy**: Non-versioned administrative and functional API.

## 2. Role-Based Access Control (RBAC) Model
Strict authorization enforced via Better Auth dynamic permissions and resource-level validation.

### Permissions Matrix
| Endpoint | Method | Required Permission Node | Context |
|----------|--------|--------------------------|---------|
| `/assign-clinical/assign` | `POST` | `clinicalAssign: ["create"]` | Assign clinician |
| `/assign-clinical/assign` | `DELETE`| `clinicalAssign: ["delete"]` | Remove clinician |
| `/assign-clinical/:userId`| `GET` | `clinicalAssign: ["view"]` | View user's clinicians |
| `/assign-clinical/trainee/:traineeId` | `GET` | `clinicalAssign: ["view"]` | View trainee's assigned users |

### Enforcement Logic
1. **Authentication**: Validates session via `auth.api.getSession()`.
2. **Authorization**: Evaluates `auth.api.userHasPermission()` for the specific `clinicalAssign` action.
3. **Resource Guarding**: All ID parameters (`userId`, `profileId`, `clinicianId`, `traineeId`) are validated via `isValidObjectId`.
4. **Self-Assignment Protection**: Business logic prevents users from being assigned as their own clinician.

## 3. Endpoint Specifications

### 3.1. Assign Clinician
- **Route**: `POST /assign-clinical/assign`
- **Purpose**: Establishes or updates a link between a user profile and a clinician.
- **Constraints**: 
  - Max 5 clinicians per profile.
  - Role must be either `trainee` or `trainer`.
- **Request Schema**:
  ```json
  {
    "userId": "string (Required, ObjectId)",
    "profileId": "string (Optional, ObjectId)",
    "clinicianId": "string (Required, ObjectId)",
    "clinicianRole": "enum (Required, 'trainee'|'trainer')",
    "clinicianEmail": "string (Required)",
    "clinicianName": "string (Required)"
  }
  ```
- **Responses**:
  - `201 Created`: Successfully assigned.
  - `400 Bad Request`: Validation failure or capacity reached.
  - `409 Conflict`: Clinician already assigned.

### 3.2. Unassign Clinician
- **Route**: `DELETE /assign-clinical/assign`
- **Purpose**: Removes a specific clinician link.
- **Request Schema**:
  ```json
  {
    "userId": "string (Required, ObjectId)",
    "profileId": "string (Optional, ObjectId)",
    "clinicianId": "string (Required, ObjectId)",
    "clinicianRole": "enum (Required, 'trainee'|'trainer')"
  }
  ```

### 3.3. Get User Clinicians
- **Route**: `GET /assign-clinical/:userId`
- **Query Parameters**:
  - `profileId`: string (Optional). Omit for default profile.

### 3.4. Get Trainee Assignments (Paginated)
- **Route**: `GET /assign-clinical/trainee/:traineeId`
- **Purpose**: Reverse lookup to see all users assigned to a specific trainee.
- **Pagination**: Supports `page` and `limit` (max 100).

## 4. Validation and Business Logic Flow
1. **Capacity Guard**: Before insertion, the system verifies `clinicians.length < 5` using a MongoDB `$expr` to prevent race conditions.
2. **Atomic Upsert**: 
   - If a doc for `(userId, profileId)` doesn't exist, it's created via `$setOnInsert`.
   - The clinician is added via `$push` with a `$not: { $elemMatch }` check to ensure uniqueness.
3. **Notification Side Effects**: Upon successful assignment/unassignment, a push notification is dispatched via Firebase Cloud Messaging or Expo, and a persistent `Notification` document is created.
4. **User Hydration**: The trainee lookup endpoint fetches real-time user data (name, email) from Better Auth via `auth.api.listUsers`.

## 5. Standardized Error Handling
- `400`: Invalid ObjectId, missing fields, or self-assignment attempt.
- `401`: Unauthorized session.
- `403`: Missing `clinicalAssign` permissions.
- `404`: Assignment record not found.

## 6. Security Considerations
- **Rate Limiting**: `writeLimiter` applied to all routes (30 requests/15m).
- **Injection Protection**: Strict type checking and `isValidObjectId` guarding.
- **Least Privilege**: Only accounts with explicit clinical management roles can perform mutations.

## 7. Performance Considerations
- **Query Optimization**: Read operations use `.lean()` and targeted `.select()` to minimize memory footprint.
- **Scalability**: Bulk trainee lookups use `Promise.all` for parallel user hydration from the Better Auth service.
- **Indexing**: MongoDB indexes on `userId` and `clinicians.clinicianId` ensure lookup performance.

## 8. Audit Logging & Observability
- All mutations are captured in the application logs.
- Traceability is maintained via `userId` and `clinicianId` fields in the `ClinicalAssignment` schema.

## 9. Assumptions and Constraints
- A user can have multiple profiles, each with its own set of clinicians.
- Hardcoded limit of 5 clinicians per profile is a business invariant.
- Clinician names and emails are cached in the assignment document to reduce join complexity.
