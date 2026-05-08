# API Specification: Course Assignment Module (v1.0.0)

## 1. Overview
The Course Assignment Module facilitates the structured distribution of educational content within the Beyond Limits Learning Hub. It provides a robust framework for administrators and trainers to assign specific learning courses to trainees or user profiles, enabling progress tracking and automated alerting.

- **Domain Context**: Learning Management System (LMS) - Content Distribution
- **Architectural Style**: RESTful API
- **Versioning**: Not explicitly versioned in path (Standard `/api` prefix)
- **Base URL**: `https://api.beyondlimits.com/api`

---

## 2. RBAC & Governance Model
The module utilizes a hierarchical Role-Based Access Control (RBAC) system powered by Better Auth. Access is gated at the routing level and verified via permission-based logic in the controllers.

### Role Hierarchy & Permissions Matrix
| Role | Action | Permission Required | Scope |
| :--- | :--- | :--- | :--- |
| **Admin** | Create/Delete | `assignCourse.create`, `assignCourse.delete` | Global (All Users/Courses) |
| **Trainer** | Create/Delete | `assignCourse.create`, `assignCourse.delete` | Own Assignments Only |
| **Trainee** | View | `assignCourse.view` | Self Assignments |
| **User** | View | `assignCourse.view` | Self (per-profile) Assignments |

### Enforcement Logic
1.  **Authentication**: Every request must carry a valid session cookie/token verified by Better Auth.
2.  **Authorization**: Explicit check for `assignCourse` permissions (create/delete/view).
3.  **Ownership Check**: For `delete` operations, non-admins are restricted to deleting only the records they personally created.
4.  **Profile Isolation**: Assignments targeting `user` roles must include a `profileId` to ensure data segregation within multi-profile accounts.

---

## 3. Endpoint Specifications

### 3.1 Create Course Assignment
`POST /assign-course`

Assigns a single course to a user/trainee. Triggers an idempotent `upsert` operation.

**Headers**:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

**Request Schema**:
| Field | Type | Required | Constraints | Description |
| :--- | :--- | :--- | :--- | :--- |
| `userId` | String | Yes | Valid UID | The ID of the assignee |
| `courseId` | String | Yes | Valid ObjectId | The ID of the course to assign |
| `profileId` | String | Conditional | Required if user | The specific profile ID for `user` roles |

**Response Schema**:
- `201 Created`: Assignment successful.
- `200 OK`: Course was already assigned (idempotent result).
- `400 Bad Request`: Validation failure (invalid ID format).
- `403 Forbidden`: Insufficient permissions or assignment to non-valid role.

---

### 3.2 Bulk Course Assignment
`POST /assign-course/bulk`

Processes multiple assignments in a single transaction (max 200 items).

**Request Schema**:
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `items` | Array | Yes | List of assignment objects |
| `items[].userId` | String | Yes | Assignee ID |
| `items[].courseId` | String | Yes | Course ID |
| `items[].profileId` | String | Optional | Profile ID |

---

### 3.3 List My Assignments
`GET /assign-course/me`

Retrieves courses assigned to the current session user.

**Query Parameters**:
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `page` | Integer | 1 | Page number |
| `limit` | Integer | 10 | Max items (Max 100) |

---

## 4. Request/Response Examples

### Example: Single Assignment Success
**Request**:
```json
{
  "userId": "user_789",
  "courseId": "65f1a2b3c4d5e6f7a8b9c0d1",
  "profileId": "prof_001"
}
```

**Response (201 Created)**:
```json
{
  "success": true,
  "message": "Course assigned",
  "data": null
}
```

### Example: Bulk Processing Result
**Response (201 Created)**:
```json
{
  "success": true,
  "message": "Bulk assignment processed",
  "data": {
    "successes": 45,
    "failures": 2,
    "results": [
      { "userId": "u1", "courseId": "c1", "status": "assigned" },
      { "userId": "u2", "courseId": "c2", "status": "error", "message": "Course not found" }
    ]
  }
}
```

---

## 5. Validation & Business Logic Flow

1.  **Identity Resolution**: Resolve assigner's role and identity from Better Auth session.
2.  **Target Verification**: Fetch target user's metadata. Verify target is a `trainee` or `user`.
3.  **Sanitization**: Validate `courseId` format via `isValidObjectId`.
4.  **Course State Check**: Ensure course `status === "published"`.
5.  **Atomic Mutation**: 
    - Use `updateOne` with `upsert: true` and `$setOnInsert`.
    - This ensures that if the record exists, metadata (like `assignedByName`) is NOT overwritten.
6.  **Side Effects (Asynchronous)**:
    - If `upsertedCount > 0`:
        - Dispatch Push Notification (Expo/Firebase).
        - Create in-app `Notification` record.
        - Dispatch `sendLearningAssignmentEmail`.

---

## 6. Error Handling Model

| Code | Status | Meaning | Mitigation |
| :--- | :--- | :--- | :--- |
| `AUTH_REQUIRED` | 401 | Missing session | Redirect to login |
| `FORBIDDEN` | 403 | RBAC violation | Verify user permissions |
| `VALIDATION_ERROR` | 400 | Invalid payload | Check ID formats/Required fields |
| `NOT_FOUND` | 404 | Resource missing | Verify Course/User existence |

---

## 7. Security & Performance
- **Input Sanitization**: Strict ObjectId validation to prevent NoSQL injection.
- **Rate Limiting**: `writeLimiter` applied to all mutation endpoints (30 req / 15 min).
- **Scalability**: Bulk operations utilize MongoDB `bulkWrite` for O(1) database roundtrips.
- **Observability**: All mutations trigger internal audit logs (where configured) and track `assignedById`.

---

## 8. Pagination & Filtering
All listing endpoints support standard pagination:
- `offset = (page - 1) * limit`
- Max page size restricted to 100 to prevent memory exhaustion.
- Metadata includes `total`, `hasNext`, and `offset`.

---

## 9. Assumptions & Constraints
1.  **Published Only**: Courses cannot be assigned unless they are in the `published` state.
2.  **Profile Requirement**: `user` roles MUST have a `profileId`; `trainee` roles MUST NOT (enforced via logic).
3.  **Idempotency**: Repeated calls with same data will return `200 OK` without triggering new notifications.
