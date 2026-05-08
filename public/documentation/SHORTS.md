# Short Videos API Specification

## 1. API Overview
### Domain Context
The Short Videos module is a core component of the Beyond Limits Learning Hub, designed for high-engagement, micro-learning content. It supports a robust two-phase upload workflow (Shell Creation + Direct-to-Cloudinary Upload) via V1 APIs to handle large media files without blocking backend threads, while retaining standard REST APIs for management, viewing, and metadata updates.

### Architectural Style
- **Style**: RESTful API
- **Versioning**: URI Versioning. V1 endpoints (`/v1/short-videos`) handle the new upload flow. Standard endpoints (`/short-videos`) handle management.
- **Base URL**: `{{BASE_URL}}/api`
- **Format**: JSON (UTF-8)

---

## 2. Role-Based Access Control (RBAC)
### Role Hierarchy
1. **Super Admin / Admin**: Full systemic control.
2. **Trainer**: Content creation and management of own content.
3. **Clinical Learner (Trainee)**: Access to clinical-restricted content + progress tracking + content creation.
4. **Individual Learner (User)**: Access to public content + progress tracking.

### Permissions Matrix
| Endpoint | Method | Path | Permission Key | Required Roles |
| :--- | :--- | :--- | :--- | :--- |
| **List Management Videos** | GET | `/short-videos` | `shortVideoStatus:view` | Admin, Trainer, Trainee |
| **List Published Videos** | GET | `/short-videos/published-videos` | `shortVideo:view` | All authenticated users |
| **Get Video Details** | GET | `/short-videos/:id` | `shortVideo:view` | All authenticated users |
| **Get Video Progress** | GET | `/short-videos/:id/progress` | (Auth Only) | All authenticated users |
| **Track Video Progress** | POST | `/short-videos/:id/progress` | (Auth Only) | All authenticated users |
| **Update Video Metadata** | PUT | `/short-videos/:id` | `shortVideo:update` | Admin, Owner |
| **Delete Video** | DELETE | `/short-videos/:id` | `shortVideo:delete` | Admin, Owner |
| **Remove Video File** | DELETE | `/short-videos/:id/video` | `shortVideo:update` | Admin, Owner |
| **Update Status (Admin)** | PUT | `/admin/change-status-short-video/:id` | N/A | Admin, Owner (Draft/Pending only) |
| **Add Resources** | POST | `/short-videos/:id/resources` | `shortVideo:update` | Admin, Owner |
| **Remove Resource** | DELETE | `/short-videos/:id/resources/:resourceId` | `shortVideo:update` | Admin, Owner |
| **Retry Subtitles** | POST | `/short-videos/:id/retry-subtitles` | (Auth Only) | Admin, Owner |
| **Create Video Shell** | POST | `/v1/short-videos` | `shortVideo:create` | Admin, Trainer, Trainee |
| **Get Signed Upload URL** | POST | `/v1/short-videos/:id/signed-upload-url` | N/A | Admin, Owner |
| **Get Upload Status** | GET | `/v1/short-videos/:id/status` | N/A | Admin, Owner |
| **Publish Video** | POST | `/v1/short-videos/:id/publish` | N/A | Admin, Owner |
| **Upload Thumbnail** | POST | `/short-videos/:id/thumbnail` | `shortVideo:update` | Admin, Owner |
| **Upload Thumbnail (V1)** | POST | `/v1/short-videos/:id/thumbnail` | `shortVideo:update` | Admin, Owner |

### Enforcement Logic
- **Authentication Scheme**: Better Auth Session Management. Standard endpoints expect cookies (`better-auth.session_token` / `__Secure-better-auth.session_token`) or `Authorization: Bearer <token>`.
- **Authorization**: Granular permission checks at the controller level using `auth.api.userHasPermission` combined with `fromNodeHeaders`.
- **Resource Ownership**: Non-admins can only modify resources where `video.user === session.user.id`.
- **Visibility Gates**: 
    - `visibility: 'clinicians'` is restricted to Admin, Trainer, and Trainee roles.
    - `visibility: 'users'` and `'all'` are accessible to all roles.
- **Access Level Gates**: Tier-based enforcement (`free`, `develop`, `master`) applies to Individual Learners.

---

## 3. Endpoint Specifications

*Note: All endpoints below strictly require the Authentication Scheme and Headers defined in Section 2 unless otherwise specified.*

### 3.1. V1 Upload Flow

#### Create Short Video Shell
**HTTP Method**: `POST`  
**Route**: `/v1/short-videos`  
**Purpose**: Initializes a video record in `draft` status without media.  
**Authentication Scheme**: Better Auth Session (Cookie/Bearer)  
**Required Roles**: Admin, Trainer, Trainee  
**Headers**: `Content-Type: application/json`, `Cookie` or `Authorization`  
**Request Schema**:
| Field | Type | Required | Constraints |
| :--- | :--- | :--- | :--- |
| `title` | String | Yes | Non-empty |
| `description` | String | Yes | Non-empty |
| `tags` | Array/String | No | Max 10 tags |
| `accessLevel` | Enum | No | `free` (default), `develop`, `master` |
| `visibility` | Enum | No | `users` (default), `clinicians`, `all` |

#### Get Signed Upload URL
**HTTP Method**: `POST`  
**Route**: `/v1/short-videos/:id/signed-upload-url`  
**Purpose**: Generates Cloudinary credentials for secure client-side upload.  
**Authentication Scheme**: Better Auth Session (Cookie/Bearer)  
**Required Roles**: Admin, Owner  
**Headers**: `Cookie` or `Authorization`  

#### Get Upload Status
**HTTP Method**: `GET`  
**Route**: `/v1/short-videos/:id/status`  
**Purpose**: Polls for completion of Cloudinary processing and webhook sync.  
**Authentication Scheme**: Better Auth Session (Cookie/Bearer)  
**Required Roles**: Admin, Owner  
**Headers**: `Cookie` or `Authorization`  

#### Publish Short Video
**HTTP Method**: `POST`  
**Route**: `/v1/short-videos/:id/publish`  
**Purpose**: Finalizes the video lifecycle, moving it from `draft` to `published`.  
**Authentication Scheme**: Better Auth Session (Cookie/Bearer)  
**Required Roles**: Admin, Owner  
**Headers**: `Cookie` or `Authorization`  
**Preconditions**: Video must be uploaded (`cloudinaryId` present).  
**Thumbnail Auto-Generation**: If the user never uploaded a custom thumbnail, one is automatically generated from the first second of the video before publishing.

#### Upload Custom Thumbnail
**HTTP Method**: `POST`  
**Route**: `/short-videos/:id/thumbnail` · `/v1/short-videos/:id/thumbnail`  
**Purpose**: Uploads a custom thumbnail image for a short video, replacing the auto-generated one.  
**Authentication Scheme**: Better Auth Session (Cookie/Bearer)  
**Required Permission**: `shortVideo:update`  
**Required Roles**: Admin, Owner  
**Headers**: `Content-Type: multipart/form-data`, `Cookie` or `Authorization`  
**Request Schema**:
| Field | Type | Required | Constraints |
| :--- | :--- | :--- | :--- |
| `thumbnail` | File | Yes | JPEG / PNG / WEBP. Max 5 MB. Field name must be `thumbnail`. |

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Thumbnail uploaded",
  "data": {
    "id": "65f...",
    "thumbnailUrl": "https://res.cloudinary.com/..."
  }
}
```
**Notes**:
- Re-uploading replaces the previous thumbnail (Cloudinary `overwrite: true`). CDN cache is invalidated automatically.
- If no custom thumbnail is ever uploaded, the system auto-generates one from the video file on publish.

### 3.2. Content Management & Viewing

#### List Management Videos
**HTTP Method**: `GET`  
**Route**: `/short-videos`  
**Purpose**: Management view for creators and admins to track status of all shorts.  
**Authentication Scheme**: Better Auth Session (Cookie/Bearer)  
**Required Roles**: Admin, Trainer, Trainee  
**Headers**: `Cookie` or `Authorization`  
**Query Parameters**: `status`, `tags`, `q`, `limit`, `page`, `sortBy`, `order`.

#### List Published Videos
**HTTP Method**: `GET`  
**Route**: `/short-videos/published-videos`  
**Purpose**: Returns a paginated list of published videos with user-specific progress.  
**Authentication Scheme**: Better Auth Session (Cookie/Bearer)  
**Required Roles**: All Authenticated Users  
**Headers**: `Cookie` or `Authorization`  
**Query Parameters**: `tags`, `q`, `limit`, `page`, `sortBy`, `order`.

#### Update Short Video
**HTTP Method**: `PUT`  
**Route**: `/short-videos/:id`  
**Purpose**: Updates metadata for a short video.  
**Authentication Scheme**: Better Auth Session (Cookie/Bearer)  
**Required Roles**: Admin, Owner  
**Headers**: `Content-Type: application/json`, `Cookie` or `Authorization`  
**Request Schema**: Optional updates to `title`, `description`, `tags`, `accessLevel`, `status`, `visibility`.

#### Add Resource
**HTTP Method**: `POST`  
**Route**: `/short-videos/:id/resources`  
**Purpose**: Manages supplementary documents (PDFs, images) attached to the video.  
**Authentication Scheme**: Better Auth Session (Cookie/Bearer)  
**Required Roles**: Admin, Owner  
**Headers**: `Content-Type: multipart/form-data`, `Cookie` or `Authorization`  
**Format**: `multipart/form-data` with `files` array.

#### Track Progress
**HTTP Method**: `POST`  
**Route**: `/short-videos/:id/progress`  
**Purpose**: Records how far a viewer has watched a short video (idempotent — stores max).  
**Authentication Scheme**: Better Auth Session (Cookie/Bearer)  
**Required Roles**: All Authenticated Users  
**Headers**: `Content-Type: application/json`, `Cookie` or `Authorization`  
**Request Body**: `{ "watchedSeconds": number }`

---

## 4. Request/Response Examples

### Example: Create Shell (V1)
**Request**:
```http
POST /api/v1/short-videos
Content-Type: application/json
Cookie: better-auth.session_token=eyJhbGciOiJIUzI1Ni...

{
  "title": "Mastering Patient Empathy",
  "description": "A 5-minute guide on clinical empathy.",
  "tags": ["clinical", "soft-skills"],
  "visibility": "clinicians"
}
```
**Response (201 Created)**:
```json
{
  "success": true,
  "message": "Short video shell created",
  "data": {
    "_id": "65f...",
    "title": "Mastering Patient Empathy",
    "status": "draft",
    "videoReady": false
  }
}
```

### Example: Track Progress
**Request**:
```http
POST /api/short-videos/65f.../progress
Content-Type: application/json
Cookie: better-auth.session_token=eyJhbGciOiJIUzI1Ni...

{
  "watchedSeconds": 120
}
```
**Response (200 OK)**:
```json
{
  "success": true,
  "message": "Short video progress updated",
  "data": {
    "watchedSeconds": 120,
    "completed": false,
    "percentWatched": 40.0,
    "durationSeconds": 300
  }
}
```

---

## 5. Validation & Business Logic Flow
1. **Creation**: User creates a "shell" containing metadata via V1 API. Status is set to `draft`.
2. **Upload Preparation**: User requests signed parameters. Backend enforces ownership and uniqueness of the `public_id`.
3. **Media Upload**: Client uploads directly to Cloudinary. Backend is idle during this phase.
4. **Webhook Synchronization**: Cloudinary notifies the backend on completion. Backend populates `cloudinaryId`, `durationSeconds`, and `thumbnailUrl` (auto-generated from the first second of the video).
5. **Optional Custom Thumbnail**: User may upload a custom thumbnail via `POST /:id/thumbnail` at any point before or after publishing.
6. **Publish Validation**: User reviews the draft and publishes. Backend prevents publishing if the video asset is missing or metadata is incomplete. If `thumbnailUrl` is still empty at publish time, it is auto-generated as a final safeguard.
7. **Access Control**: On read requests, the video becomes visible to the target audience based on `visibility` gates (e.g., clinicians-only) and `accessLevel` gates (e.g., master-tier users).

---

## 6. Standardized Error Handling Model
All endpoints return standard HTTP status codes mapped to structured error payloads.

| Error Code | HTTP Status | Meaning |
| :--- | :--- | :--- |
| `BAD_REQUEST` | 400 | Validation failed, invalid object ID, or missing required fields. |
| `UNAUTHORIZED` | 401 | Session missing, invalid, or expired. |
| `FORBIDDEN` | 403 | RBAC check failed, visibility mismatch, or ownership mismatch. |
| `NOT_FOUND` | 404 | Video or resource ID does not exist. |
| `INTERNAL_ERROR` | 500 | Server-side failure or database connection issue. |

**Error Payload Format**:
```json
{
  "success": false,
  "message": "Forbidden: insufficient permissions",
  "data": null
}
```

---

## 7. Security Considerations
- **Rate Limiting**: `writeLimiter` applied to all POST/PUT/DELETE routes to prevent brute force and DoS attacks (30 requests per 15 minutes).
- **Signed Uploads**: Replay protection ensured by timestamped Cloudinary signatures. Webhook updates validate signature authenticity.
- **Input Sanitization**: Metadata titles and descriptions are trimmed and escaped. Tags are normalized to slugs.
- **Least Privilege**: Users cannot escalate `accessLevel` or `visibility` beyond their own role permissions. Admins exclusively manage `published` / `rejected` statuses for other users' content.
- **NoSQL Injection**: Input parameters (like `id`) are strictly validated using `isValidObjectId` before database queries.

---

## 8. Pagination, Filtering, and Sorting
- **Pagination**: Implement `limit` and `offset` logic across list endpoints. Returns structured metadata: `{ page, offset, limit, total, hasNext }`.
- **Filtering**: Query parameters support filtering by `tags`, `status`, and free-text search (`q`) across title and description using `$regex` or text indexes.
- **Sorting**: Support `sortBy` (e.g., `createdAt`, `title`, `tags`) and `order` (`asc`/`desc`).

---

## 9. Performance Considerations
- **Caching & Idempotency**: Progress tracking leverages MongoDB's `$max` and `findOneAndUpdate` to maintain idempotency and minimize write locking.
- **HLS Streaming**: The `buildHlsUrl` helper dynamically transforms `cloudinaryUrl` fields into Adaptive Bitrate (ABR) m3u8 playlists, shifting bandwidth pressure to Cloudinary's CDN.
- **Background Processes**: Notifications and subtitle retry logic are processed asynchronously to avoid blocking the main Event Loop.

---

## 10. Audit Logging & Observability
- **Traceability**: All state changes (Shell creation, status updates, deletions) generate structured logs via `logger.info` (`[ShortVideosV1] Shell created: ...`).
- **Metrics**: Track learner engagement via `watchedSeconds`, `percentWatched`, and the `completed` flag in `ShortVideoProgress` schemas.

---

## 11. Assumptions & Constraints
- **Storage Strategy**: Media files and resources are hosted on Cloudinary; MongoDB only stores reference IDs and metadata.
- **Progress Tracking Constraints**: Users in the `user` role must have an active `profileId` present in the Better Auth session to track progress. Admin/Trainer/Trainee roles use their base account ID.
- **Video Format Constraint**: Cloudinary handles transcoding, but client uploads should ideally be standardized formats (MP4/WebM) to reduce processing overhead.
- **Old Endpoints**: The legacy `POST /short-videos` endpoint is deprecated and strictly excluded from client integration usage.
