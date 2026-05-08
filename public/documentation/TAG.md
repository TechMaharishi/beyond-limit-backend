# Tag Management API Specification

## 1. API Overview
- **Domain Context**: Centralized management of tags used across the Beyond Limits Learning Hub platform for content classification and filtering.
- **Architectural Style**: REST-compliant architecture.
- **Base URL Conventions**: `/api`
- **Versioning Strategy**: Non-versioned internal administrative API.

## 2. Role-Based Access Control (RBAC) Model
The Tag Management API leverages Better Auth's dynamic permission system to enforce granular authorization. Access is evaluated at the request lifecycle's earliest stage via headers.

### Permissions Matrix
| Endpoint | Method | Required Permission Node | Action Type |
|----------|--------|--------------------------|-------------|
| `/admin/create-tags` | `POST` | `tag: ["create"]` | Mutation |
| `/admin/tags` | `GET` | `tag: ["view"]` | Read |
| `/admin/tags/:id/deactivate` | `PUT` | `tag: ["delete"]` | Mutation (Soft Delete) |
| `/admin/tags/:id/activate` | `PUT` | `tag: ["update"]` | Mutation (Reactivate) |
| `/admin/tags/:id` | `DELETE`| `tag: ["delete"]` | Mutation (Hard Delete) |

### Enforcement Logic
1. **Authentication**: `auth.api.getSession()` validates the Bearer token or session cookie.
2. **Authorization**: `auth.api.userHasPermission()` dynamically evaluates if the authenticated user holds the explicit permission required for the operation (`tag:create`, `tag:view`, etc.).
3. **Resource Ownership**: Tags are global taxonomy elements; authorization is strictly role-based (Super Admin/Admin/Trainer).
4. **Validation**: All `:id` parameters are guarded by `isValidObjectId` to prevent Mongoose CastErrors.

## 3. Endpoint Specifications

---

### 3.1. Create Tag
- **Endpoint**: `POST /admin/create-tags`
- **Purpose**: Creates a new, globally available taxonomy tag. Generates a unique URL-friendly slug.
- **Authentication Scheme**: Better Auth Session (Token/Cookie).
- **Required Headers**: `Authorization: Bearer <token>` or valid session cookie.
- **Rate Limit**: `writeLimiter` applied.

#### Request Schema
```json
{
  "name": "string (Required, min length 1)"
}
```

#### Responses
- **201 Created**: Tag successfully created.
- **400 Bad Request**: Missing or invalid tag name.
- **401 Unauthorized**: Missing or invalid authentication.
- **403 Forbidden**: Insufficient permissions (`tag:create` missing).
- **409 Conflict**: Tag with the resulting slug already exists.

#### Example Request
```bash
curl -X POST /admin/create-tags \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Machine Learning"}'
```

#### Example Response (201)
```json
{
  "success": true,
  "message": "Tag created",
  "data": {
    "_id": "60d5ecb8b392d700153f3a12",
    "name": "Machine Learning",
    "slug": "machine-learning",
    "createdBy": "60d5eca0b392d700153f3a11",
    "active": true,
    "createdAt": "2023-10-01T12:00:00Z",
    "updatedAt": "2023-10-01T12:00:00Z"
  }
}
```

---

### 3.2. Get All Tags
- **Endpoint**: `GET /admin/tags`
- **Purpose**: Retrieves all tags in the system.
- **Authentication Scheme**: Better Auth Session.
- **Required Headers**: `Authorization: Bearer <token>`

#### Responses
- **200 OK**: Returns an array of tags.
- **401 Unauthorized**: Missing or invalid authentication.
- **403 Forbidden**: Insufficient permissions (`tag:view` missing).

#### Example Response (200)
```json
{
  "success": true,
  "message": "Tags fetched",
  "data": [
    {
      "_id": "60d5ecb8b392d700153f3a12",
      "name": "Machine Learning",
      "slug": "machine-learning",
      "active": true,
      "createdBy": "60d5eca0b392d700153f3a11",
      "createdAt": "2023-10-01T12:00:00Z",
      "updatedAt": "2023-10-01T12:00:00Z"
    }
  ]
}
```

---

### 3.3. Deactivate Tag (Soft Delete)
- **Endpoint**: `PUT /admin/tags/:id/deactivate`
- **Purpose**: Soft deletes a tag, rendering it inactive without removing historical associations.
- **Authentication Scheme**: Better Auth Session.
- **Required Headers**: `Authorization: Bearer <token>`
- **Rate Limit**: `writeLimiter` applied.

#### Path Parameters
- `id`: string (Required, valid MongoDB ObjectId)

#### Responses
- **200 OK**: Tag successfully deactivated.
- **400 Bad Request**: Missing or invalid MongoDB ObjectId.
- **404 Not Found**: Tag does not exist.

#### Example Response (200)
```json
{
  "success": true,
  "message": "Tag deactivated",
  "data": {
    "_id": "60d5ecb8b392d700153f3a12",
    "active": false,
    "deletedAt": "2023-10-02T12:00:00Z"
  }
}
```

---

### 3.4. Activate Tag
- **Endpoint**: `PUT /admin/tags/:id/activate`
- **Purpose**: Restores a previously deactivated tag.
- **Authentication Scheme**: Better Auth Session.
- **Required Headers**: `Authorization: Bearer <token>`
- **Rate Limit**: `writeLimiter` applied.

#### Path Parameters
- `id`: string (Required, valid MongoDB ObjectId)

#### Responses
- **200 OK**: Tag successfully activated.
- **400 Bad Request**: Missing or invalid MongoDB ObjectId.
- **404 Not Found**: Tag does not exist.

#### Example Response (200)
```json
{
  "success": true,
  "message": "Tag activated",
  "data": {
    "_id": "60d5ecb8b392d700153f3a12",
    "active": true
  }
}
```

---

### 3.5. Delete Tag (Hard Delete)
- **Endpoint**: `DELETE /admin/tags/:id`
- **Purpose**: Permanently removes a tag from the database.
- **Authentication Scheme**: Better Auth Session.
- **Required Headers**: `Authorization: Bearer <token>`
- **Rate Limit**: `writeLimiter` applied.

#### Path Parameters
- `id`: string (Required, valid MongoDB ObjectId)

#### Responses
- **200 OK**: Tag successfully hard deleted.
- **400 Bad Request**: Missing or invalid MongoDB ObjectId.
- **404 Not Found**: Tag does not exist.

#### Example Response (200)
```json
{
  "success": true,
  "message": "Tag hard deleted",
  "data": {
    "_id": "60d5ecb8b392d700153f3a12",
    "name": "Machine Learning"
  }
}
```

## 4. Validation and Business Logic Flow
1. **Sanitization**: Input strings (like `name`) are verified to be strings.
2. **Slug Generation**: The `name` is transformed using `s.toLowerCase().trim().replace(/\s+/g, "-")`.
3. **Validation**: The generated slug is validated for existence to prevent empty slugs.
4. **Uniqueness Check**: A query (`Tag.findOne({ slug })`) is performed prior to creation to enforce uniqueness and return a deterministic 409 Conflict if violated.
5. **Idempotency**: 
   - `PUT /deactivate` and `PUT /activate` are idempotent; subsequent calls with the same state yield the same database state.
   - `DELETE` is idempotent but returns 404 on subsequent calls.
6. **Side Effects**: Hard deleting tags does not automatically cascade to remove references in content documents (courses, shorts).

## 5. Standardized Error Handling Model
All endpoints utilize the `sendError` utility, standardizing the payload format.

### Error Payload Schema
```json
{
  "success": false,
  "message": "Human readable error description"
}
```

### HTTP Status Code Mapping
- `400`: Validation failure (invalid ObjectId, missing required fields, invalid format).
- `401`: Missing or invalid session token.
- `403`: Insufficient Better Auth permissions.
- `404`: Target resource (Tag) not found in the database.
- `409`: Resource state conflict (Slug already exists).
- `500`: Unhandled internal server error (caught via `next(error)`).

## 6. Security Considerations
- **Input Sanitization**: Tag names are strictly type-checked (`typeof name !== "string"`). Slugs are aggressively normalized to prevent injection or malicious path creation.
- **Rate Limiting**: The `writeLimiter` is explicitly applied to `POST`, `PUT`, and `DELETE` routes to prevent denial-of-service and brute-force taxonomy creation.
- **Least-Privilege Enforcement**: Granular CRUD permissions (`tag:create`, `tag:view`, `tag:update`, `tag:delete`) isolate privileges. Deactivation and Hard Deletion share the `tag:delete` permission, while Reactivation uses `tag:update`.
- **ObjectId Validation**: Pre-flight validation (`isValidObjectId`) occurs before database queries to prevent CastErrors and potential NoSQL injection vectors.

## 7. Pagination, Filtering, and Sorting
- **Pagination/Filtering**: Currently, the `GET /admin/tags` endpoint returns the entire taxonomy graph without pagination or query filtering.
- **Sorting**: Tags are deterministically sorted by `updatedAt` in descending order (`-1`), prioritizing recently modified tags.

## 8. Performance Considerations
- **Database Query Optimizations**: The `GET` endpoint utilizes `lean()` to bypass Mongoose document hydration, significantly reducing memory overhead and time complexity. Unnecessary fields are excluded via `.select()`.
- **Scalability**: As the tag collection scales, fetching the entire list via `GET /admin/tags` may introduce payload bloat. Future iterations should introduce limit/offset cursor pagination.
- **Indexes**: Uniqueness on the `slug` field is enforced via business logic; it is highly recommended to ensure a MongoDB unique index exists on `slug` to prevent race conditions during concurrent creation.

## 9. Audit Logging and Observability
- All state-mutating requests (`createTag`, `activateTag`, `deactivateTag`, `deleteTag`) are subject to the global application error boundary (`next(error)`).
- Traceability relies on the `createdBy` field appended during tag creation.
- **Note**: Deletion and activation events currently rely on infrastructure-level logs; explicit audit log hooks should be integrated for compliance if necessary.

## 10. Assumptions and Constraints
- It is assumed the frontend dynamically handles the 403 Forbidden responses to hide/disable UI elements.
- Soft deletion (`deactivateTag`) is the preferred method for removing tags. Hard deletion (`deleteTag`) is an administrative override.
- Tag slugs are assumed to be the primary unique identifier for URL routing on the client side.
