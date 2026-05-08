# Shorts Assignment API Specification

## 1. API Overview
- **Domain Context**: Facilitates the distribution and tracking of micro-learning content (Short Videos) to users. It manages the "Short-Assignment" link, enabling admins, trainers, and trainees to curate content for specific learner profiles.
- **Architectural Style**: RESTful API.
- **Base URL Conventions**: `/api`.
- **Versioning Strategy**: Non-versioned functional API.

## 2. Role-Based Access Control (RBAC) Model
Strict authorization enforced via Better Auth dynamic permissions and hierarchical role validation.

### Permissions Matrix
| Endpoint | Method | Required Permission Node | Context |
|----------|--------|--------------------------|---------|
| `/assign-shorts` | `POST` | `assignShorts: ["create"]` | Single assignment creation |
| `/assign-shorts/bulk` | `POST` | `assignShorts: ["create"]` | Batch assignment creation |
| `/assign-shorts` | `DELETE`| `assignShorts: ["delete"]` | Individual unassignment |
| `/assign-shorts/bulk` | `DELETE`| `assignShorts: ["delete"]` | Batch unassignment |
| `/assign-shorts/me` | `GET` | Authenticated | View self-assignments |
| `/assign-shorts/assigned-by-me`| `GET` | `assignShorts: ["view"]` | View assignments made by caller |
| `/assign-shorts/assignees/:userId`| `GET` | `assignShorts: ["view"]` | View target user's assignments |

### Enforcement Logic
1. **Authentication**: Validates session via `auth.api.getSession()`.
2. **Authorization**: Evaluates `auth.api.userHasPermission()` for the specific `assignShorts` action.
3. **Target Validation**: 
   - Admins can assign to `trainer`, `trainee`, and `user`.
   - Trainers can assign to `trainee` and `user`.
   - Trainees can assign only to `user`.
4. **Profile Scoping**: For role="user" targets, a `profileId` is mandatory to isolate content per learner profile.

## 3. Endpoint Specifications

### 3.1. Create Short Assignment
- **Route**: `POST /assign-shorts`
- **Request Schema**:
  ```json
  {
    "userId": "string (Required, ObjectId)",
    "shortVideoId": "string (Required, ObjectId)",
    "profileId": "string (Required for role=user targets, ObjectId)"
  }
  ```
- **Business Rule**: Video must be in `published` status.

### 3.2. Bulk Create Short Assignments
- **Route**: `POST /assign-shorts/bulk`
- **Request Schema**:
  ```json
  {
    "items": [
      {
        "userId": "string (Required, ObjectId)",
        "shortVideoId": "string (Required, ObjectId)",
        "profileId": "string (Optional, ObjectId)"
      }
    ]
  }
  ```
- **Constraint**: Maximum 200 items per request.
- **Note**: `profileId` is mandatory for any item where the target user has a `user` role.

### 3.3. Delete Short Assignment
- **Route**: `DELETE /assign-shorts`
- **Logic**: Admins can delete any record; Trainers/Trainees only those they personally created.

### 3.4. List My Assignments
- **Route**: `GET /assign-shorts/me`
- **Logic**: For role="user", automatically scopes to the `activeProfileId` in the session.

## 4. Validation and Business Logic Flow
1. **Sanitization**: All ID strings are validated via `isValidObjectId` to prevent `CastError`.
2. **Idempotency**: Creation uses `updateOne` with `$setOnInsert` and `upsert: true` to prevent duplicate assignment documents.
3. **Atomic Bulk Processing**: The bulk endpoint uses `ShortAssignment.bulkWrite` (unordered) for high-performance batch updates.
4. **Alerting Side Effects**:
   - Dispatches Push Notification (Expo/Firebase).
   - Records persistent In-App Notification document.
   - Triggers `sendLearningAssignmentEmail` via Resend/Mailer.

## 5. Standardized Error Handling
- `400`: Invalid ObjectId, missing required fields, or missing `activeProfileId`.
- `401`: Unauthorized session.
- `403`: Insufficient RBAC permissions or invalid target role hierarchy.
- `404`: Short video or assignee user not found.

## 6. Security Considerations
- **Rate Limiting**: `writeLimiter` applied to ALL routes (30 requests/15m).
- **Input Sanitization**: Strict type checking and ObjectId validation.
- **Data Isolation**: `profileId` ensures that assignments are only visible to the correct learner profile within a user account.

## 7. Performance Considerations
- **Hydration**: Retrieval endpoints parallelize `fetchShortMap` and `fetchProgressMap` via `Promise.all`.
- **Query Efficiency**: Uses `.lean()` and targeted `.select()` projections.
- **Indexing**: 
  - Compound unique index on `{ assignedToId, shortVideoId, assignedByRole, profileId }`.
  - Secondary index on `{ assignedById, assignedByRole, createdAt: -1 }`.

## 8. Audit Logging & Observability
- All assignments record the `assignedById` and `assignedByRole` for traceability.
- Successful bulk operations return a summary of `successes`, `failures`, and detailed `results` per item.

## 9. Pagination & Filtering Mechanism
- **Parameters**:
  - `limit`: Integer (1-100, default 10).
  - `page`: Integer (default 1).
  - `profileId`: (Optional) Filter by specific learner profile.
- **Response Metadata**:
  ```json
  {
    "page": 1,
    "limit": 10,
    "total": 150,
    "hasNext": true
  }
  ```

## 10. Request/Response Examples

### 3.1. Create Assignment (Success)
**Request:** `POST /api/assign-shorts`
```json
{
  "userId": "65f1234567890abcdef12345",
  "shortVideoId": "65f9876543210fedcba54321",
  "profileId": "65f000000000000000000001"
}
```
**Response (201 Created):**
```json
{
  "success": true,
  "message": "Short assigned to user"
}
```

### 3.2. Bulk Create (Partial Success Example)
**Request:** `POST /api/assign-shorts/bulk`
```json
{
  "items": [
    { "userId": "ID_1", "shortVideoId": "VIDEO_A", "profileId": "PROF_1" },
    { "userId": "ID_2", "shortVideoId": "VIDEO_A" }
  ]
}
```
**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "successes": 1,
    "failures": 1,
    "results": [
      { "userId": "ID_1", "shortVideoId": "VIDEO_A", "status": "assigned" },
      { "userId": "ID_2", "shortVideoId": "VIDEO_A", "status": "error", "message": "profileId is required..." }
    ]
  }
}
```

## 11. Assumptions and Constraints
- A short video cannot be assigned unless its status is `published`.
- Progress tracking is decoupled; the assignment only links the video to the user/profile.
- Role="user" accounts must have an active profile selected in their session to view self-assignments.
- Bulk operations are unordered; a single item failure does not roll back the entire batch.

