# Course Videos API — Production Documentation

## Table of Contents

1. [API Overview](#1-api-overview)
2. [RBAC Model](#2-rbac-model)
3. [Error Handling Model](#3-error-handling-model)
4. [Pagination, Filtering & Sorting](#4-pagination-filtering--sorting)
5. [Endpoint Specifications](#5-endpoint-specifications)
6. [V1 Signed Upload Flow](#6-v1-signed-upload-flow)
7. [Security Considerations](#7-security-considerations)
8. [Performance & Observability](#8-performance--observability)

---

## 1. API Overview

| Property | Value |
|---|---|
| Domain | Course content management — structured courses with chapters, lessons, quizzes, and videos |
| Style | REST over HTTP/HTTPS |
| Versioning | Path-based. Legacy routes: `/api/courses/...`. V1 (signed upload): `/api/v1/courses/...` |
| Base URL | `{BETTER_AUTH_URL}/api` |
| Authentication | Session cookie managed by Better Auth. All endpoints require an active session. |
| Media Hosting | Cloudinary (video + images). Direct upload via signed URL in V1 flow. |

### Architectural Notes

- Courses are top-level documents containing embedded chapters → lessons → videos + quizzes.
- Aggregate stats (`totalDurationSeconds`, `totalQuizzes`, `totalChapters`) are recomputed synchronously on every mutating operation.
- Subtitle generation is asynchronous: on video upload, a `CourseSubtitleJob` is enqueued and picked up by a background worker.
- Course status lifecycle: `draft` → `pending` → `published` | `rejected`.
- Two upload paths exist for lesson videos:
  - **Legacy** (`PATCH /courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/video`): client sends Cloudinary metadata after uploading externally.
  - **V1** (`POST /api/v1/courses/...`): backend issues a signed URL; client uploads directly to Cloudinary; webhook fires to persist metadata.

---

## 2. RBAC Model

### Role Definitions

| Role | Description |
|---|---|
| `admin` | Full platform access. Approves/rejects courses, sees all content regardless of visibility. |
| `trainer` | Content creator. Creates and manages their own courses. Can view all published content. |
| `trainee` | Clinical learner. Consumes all published content. Can save/bookmark courses. |
| `user` | General public learner. Subject to visibility (`all` only) and `accessLevel` gating. |

### Access Level Hierarchy (user role only)

| User `accountType` | Accessible Course `accessLevel` values |
|---|---|
| `free` (default) | `free` |
| `develop` | `free`, `develop` |
| `master` | `free`, `develop`, `master` |

Clinicians (admin / trainer / trainee) bypass `accessLevel` gating entirely.

### Permissions Matrix

| Endpoint | admin | trainer | trainee | user |
|---|---|---|---|---|
| `POST /courses` | ✅ | ✅ | ❌ | ❌ |
| `GET /courses` (management list) | ✅ | ✅ own+published | ✅ published only | ❌ |
| `GET /courses/published-videos` | ✅ all visibility | ✅ all visibility | ✅ all visibility | ✅ `visibility:all` only |
| `GET /courses/completed` | ✅ | ✅ | ✅ | ✅ |
| `GET /courses/saved-course` | ✅ | ✅ | ✅ | ✅ |
| `GET /courses/:id` | ✅ | ✅ | ✅ | ✅ if `visibility:all` + accessLevel match |
| `PATCH /courses/:id` | ✅ | ✅ own only | ❌ | ❌ |
| `DELETE /courses/:id` | ✅ | ✅ own only | ❌ | ❌ |
| `DELETE /courses/:id/thumbnail` | ✅ | ✅ own only | ❌ | ❌ |
| `GET /courses/:id/progress` | ✅ | ✅ | ✅ | ✅ |
| `POST /courses/:id/save` | ✅ | ✅ | ✅ | ✅ |
| `POST /courses/:id/resources/upload` | ✅ | ✅ own only | ❌ | ❌ |
| `DELETE /courses/:id/resources/:idx` | ✅ | ✅ own only | ❌ | ❌ |
| `POST /courses/:courseId/chapters` | ✅ | ✅ own only | ❌ | ❌ |
| `POST /courses/:courseId/chapters/:cIdx/lessons` | ✅ | ✅ own only | ❌ | ❌ |
| `DELETE /courses/:courseId/chapters/:cIdx/lessons/:lIdx` | ✅ | ✅ own only | ❌ | ❌ |
| `POST /courses/:courseId/chapters/:cIdx/quizzes` | ✅ | ✅ own only | ❌ | ❌ |
| `DELETE /courses/:courseId/chapters/:cIdx/quizzes/:qIdx` | ✅ | ✅ own only | ❌ | ❌ |
| `PATCH /courses/:courseId/chapters/:cIdx/lessons/:lIdx/video` | ✅ | ✅ own only | ❌ | ❌ |
| `DELETE /courses/:courseId/chapters/:cIdx/lessons/:lIdx/videos/:vIdx` | ✅ | ✅ own only | ❌ | ❌ |
| `PUT /courses/:courseId/chapters/:chapterId/lessons/progress` | ✅ | ✅ | ✅ | ✅ |
| `POST /courses/:courseId/chapters/:chapterId/quiz/responses` | ✅ | ✅ | ✅ | ✅ |
| `PUT /admin/change-status-course/:id` | ✅ all statuses | ✅ `draft`/`pending` own | ✅ `draft`/`pending` own | ❌ |
| `POST /courses/videos-upload` (metadata only) | ✅ | ✅ | ❌ | ❌ |
| `POST /courses/delete-cloudinary-video` | ✅ | ✅ | ❌ | ❌ |
| `POST /courses/:courseId/retry-subtitles` | ✅ | ✅ | ❌ | ❌ |
| `POST /api/v1/courses/.../signed-upload-url` | ✅ | ✅ own only | ❌ | ❌ |
| `GET /api/v1/courses/.../video-status` | ✅ | ✅ own only | ❌ | ❌ |

### Authorization Enforcement Order

For every request, enforcement occurs in this order:

1. **Authentication** — `auth.api.getSession()`. Returns `401` if no active session.
2. **Permission check** — `auth.api.userHasPermission()`. Returns `403` if the role lacks the required permission.
3. **Resource existence** — MongoDB lookup. Returns `404` if not found.
4. **Ownership check** — `course.user.toString() === user.id`. Returns `403` if neither admin nor owner (for write operations).
5. **Visibility check** — For `user` role reads: course `visibility` must be `"all"`.
6. **Access level check** — For `user` role reads: user `accountType` must permit course `accessLevel`.
7. **Status check** — For non-owner, non-clinician reads: `course.status` must be `"published"`.

---

## 3. Error Handling Model

All error responses follow a consistent envelope:

```json
{
  "success": false,
  "message": "<human-readable description>",
  "data": null
}
```

All success responses:

```json
{
  "success": true,
  "message": "<human-readable description>",
  "data": { ... },
  "pagination": { ... }
}
```

### HTTP Status Codes

| Code | Meaning |
|---|---|
| `200` | Operation succeeded |
| `201` | Resource created |
| `400` | Validation failure / bad input |
| `401` | No valid session |
| `403` | Authenticated but not authorized |
| `404` | Resource not found |
| `500` | Unhandled server error / Cloudinary failure |

---

## 4. Pagination, Filtering & Sorting

Applies to: `GET /courses`, `GET /courses/published-videos`, `GET /courses/completed`, `GET /courses/saved-course`.

### Query Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | integer ≥ 1 | `1` | Page number |
| `limit` | integer ≥ 1 | `10` | Items per page |
| `q` | string | — | Case-insensitive text search on `title` and `description` |
| `tags` / `tag` | string or comma-separated | — | Filter by tag slugs. Unknown slugs return `400`. |
| `sortBy` / `by` | `createdAt` \| `title` \| `tags` | `createdAt` | Sort field |
| `order` / `sort` | `asc` \| `desc` \| `dsc` | `desc` | Sort direction |
| `status` | `draft` \| `pending` \| `published` \| `rejected` | — | Status filter (management list only) |

### Pagination Response Envelope

```json
{
  "success": true,
  "message": "...",
  "data": [...],
  "pagination": {
    "page": 1,
    "offset": 0,
    "limit": 10,
    "total": 42,
    "hasNext": true
  }
}
```

> Note: `GET /courses/completed` and `GET /courses/saved-course` perform in-memory pagination after fetching all matching documents. These are not MongoDB-level paginated queries and will degrade at scale.

---

## 5. Endpoint Specifications

---

### POST /api/courses

**Purpose:** Create a new course.

**Required permission:** `course:create` (admin, trainer)

**Content-Type:** `multipart/form-data` (when uploading thumbnail) or `application/json`

#### Request Body

| Field | Type | Required | Constraints |
|---|---|---|---|
| `title` | string | ✅ | Non-empty |
| `description` | string | ✅ | Non-empty |
| `tags` | string or string[] | ❌ | Comma-separated slugs or array. Unknown slugs silently dropped. |
| `status` | `draft` \| `pending` \| `published` | ❌ | Default: `draft` |
| `accessLevel` | `free` \| `develop` \| `master` | ❌ | Default: `free` |
| `visibility` | `clinicians` \| `users` \| `all` | ❌ | Default: `users` |
| `thumbnailUrl` | string | ❌ | External URL |
| `thumbnail` (file) | image file | ❌ | Max 100 MB. Uploaded to `course_thumbnails/` in Cloudinary. |

#### Response `201`

Returns the full Mongoose course document.

#### Side Effects

- If `status: "pending"`: pushes FCM/Expo notification to all admin users.
- Creates in-app `Notification` record for each admin.

---

### GET /api/courses

**Purpose:** Management-facing paginated list. Shows courses scoped by role.

**Required permission:** `courseVideoStatus:view` (admin, trainer, trainee)

**Role-based query scope:**

| Role | Visible courses |
|---|---|
| admin | Own drafts + all pending + all published (+ rejected if `status=rejected` filter) |
| trainer | Own courses in any status; all published by others |
| trainee | Published courses only (or filtered by `status` param) |

**Query Parameters:** See [Section 4](#4-pagination-filtering--sorting). `status` filter is valid here.

#### Response `200`

```json
{
  "data": [
    {
      "_id": "string",
      "title": "string",
      "description": "string",
      "tags": ["string"],
      "status": "draft|pending|published|rejected",
      "accessLevel": "free|develop|master",
      "visibility": "clinicians|users|all",
      "thumbnailUrl": "string",
      "totalDurationSeconds": 0,
      "totalQuizzes": 0,
      "totalChapters": 0,
      "user": "string",
      "createdBy": { "_id": "string", "name": "string", "email": "string" },
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ],
  "pagination": { "page": 1, "offset": 0, "limit": 10, "total": 0, "hasNext": false }
}
```

> `chapters` is excluded from the response. `thumbnailUrl` falls back to the first lesson video thumbnail if the course-level thumbnail is empty.

---

### GET /api/courses/published-videos

**Purpose:** Consumer-facing paginated list. Published courses only, visibility-filtered by role.

**Required permission:** `course:view` (all roles)

**Visibility filtering:**

| Role | Visible visibility values |
|---|---|
| admin / trainer / trainee | `clinicians`, `users`, `all` |
| user | `all` only |

Includes per-course progress summary and saved status for the requesting user.

#### Response `200`

```json
{
  "data": [
    {
      "_id": "string",
      "title": "string",
      "description": "string",
      "tags": ["string"],
      "status": "published",
      "accessLevel": "free|develop|master",
      "visibility": "clinicians|users|all",
      "thumbnailUrl": "string",
      "totalDurationSeconds": 0,
      "user": "string",
      "createdBy": { "_id": "string", "name": "string", "email": "string" },
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601",
      "saved": false,
      "progressSummary": {
        "percentCompleted": 0.0,
        "completed": false
      }
    }
  ],
  "pagination": { "page": 1, "offset": 0, "limit": 10, "total": 0, "hasNext": false }
}
```

---

### GET /api/courses/completed

**Purpose:** Returns published courses the current user has ≥ 90% watched.

**Required permission:** `course:view` (all roles)

> **Implementation note:** Fetches all matching published courses into memory, computes completion per course, filters, then paginates. The `total` in the pagination envelope reflects completed count only.

#### Response `200`

```json
{
  "data": [
    {
      "_id": "string",
      "title": "string",
      "thumbnailUrl": "string",
      "totalDurationSeconds": 0,
      "progressSummary": {
        "watchedSeconds": 0,
        "percentWatched": 100.0,
        "completed": true,
        "durationSeconds": 0
      }
    }
  ],
  "pagination": { "page": 1, "offset": 0, "limit": 10, "total": 0, "hasNext": false }
}
```

---

### GET /api/courses/saved-course

**Purpose:** Returns courses the current user has bookmarked, ordered by save time (newest first).

**Required permission:** `course:view` (all roles)

> Ordering is preserved from `SavedCourse` document insertion time. The `total` reflects all saved courses, not just the current page.

#### Response `200`

Same structure as `GET /courses/completed` with `progressSummary`.

---

### GET /api/courses/:id

**Purpose:** Fetch full course document including all chapters, lessons, quizzes.

**Required permission:** `course:view` (all roles)

**Access rules:**

- Clinicians (admin / trainer / trainee) and course owners: unrestricted.
- `user` role:
  - Course `status` must be `published`.
  - Course `visibility` must be `"all"`.
  - Course `accessLevel` must be within user's `accountType` tier.

**Side effect:** Video `cloudinaryUrl` fields are replaced with HLS streaming URLs on the fly (`format: m3u8`, `streaming_profile: auto`). This transform is response-only and does not modify the database.

#### Response `200`

Full course document with chapters → lessons → videos (HLS URLs), quizzes with `correctOptionIndexes`.

---

### PATCH /api/courses/:id

**Purpose:** Update course metadata, chapters structure, thumbnail, or status.

**Required permission:** `course:create` (admin, trainer)

**Ownership:** Admin or course owner only.

#### Request Body (all fields optional)

| Field | Type | Constraints |
|---|---|---|
| `title` | string | Non-empty |
| `description` | string | — |
| `tags` | string or string[] | Known slugs only. Unknown slugs are rejected with `400` if provided but none match. |
| `accessLevel` | string | `free` \| `develop` \| `master` |
| `visibility` | string | `clinicians` \| `users` \| `all` |
| `status` | string | `draft` \| `pending` \| `published`. Only admin can set `published`. |
| `chapters` | array | Full replacement of chapters array. Triggers `recomputeCourseStats` and subtitle job enqueue. |
| `thumbnailUrl` | string | External URL. Clears thumbnail if empty string. |
| `thumbnail` (file) | image | Replaces existing Cloudinary thumbnail. Old asset destroyed. |

#### Response `200`

Updated course document.

#### Side Effects

- If `chapters` replaced: `recomputeCourseStats` runs synchronously; `enqueueCourseSubtitleJobs` fires asynchronously.
- If `thumbnailUrl` cleared and a Cloudinary ID existed: old thumbnail is destroyed.

---

### DELETE /api/courses/:id

**Purpose:** Hard-delete a course and all associated Cloudinary assets.

**Required permission:** Admin or owner (no `userHasPermission` check — ownership/admin check only).

#### Side Effects

- Destroys all lesson videos from Cloudinary.
- Destroys course thumbnail from Cloudinary (infers public_id from URL if not stored separately).
- Destroys all resource files from Cloudinary by MIME-based resource type.
- Attempts `delete_resources_by_prefix` + `delete_folder` for the course resources folder.

#### Response `200`

```json
{ "data": { "id": "string" } }
```

---

### DELETE /api/courses/:id/thumbnail

**Purpose:** Remove the course thumbnail.

**Ownership:** Admin or owner only.

#### Response `200`

Updated course document with `thumbnailUrl: ""` and `thumbnailCloudinaryId: ""`.

---

### GET /api/courses/:id/progress

**Purpose:** Full course document with per-lesson and per-quiz progress for the requesting user.

**Required permission:** `course:view` (all roles)

**Access:** Admin and owner bypass status check. Others require `status: published`.

#### Response `200`

```json
{
  "data": {
    "courseId": "string",
    "title": "string",
    "createdBy": { "_id": "string", "name": "string", "email": "string" },
    "chapters": [
      {
        "chapterId": "string",
        "chapterIndex": 0,
        "title": "string",
        "durationSeconds": 0,
        "watchedSeconds": 0,
        "lessonsPercentWatched": 0.0,
        "quizAttemptedPercent": 0.0,
        "percentCompleted": 0.0,
        "lessons": [
          {
            "lessonIndex": 0,
            "title": "string",
            "videos": [...],
            "durationSeconds": 0,
            "watchedSeconds": 0,
            "percentWatched": 0.0,
            "completed": false
          }
        ],
        "quiz": {
          "title": "string",
          "attempted": false,
          "totalQuestions": 0,
          "attemptedCount": 0,
          "attemptedPercent": 0.0,
          "questions": [
            {
              "questionIndex": 0,
              "type": "single|multiple",
              "prompt": "string",
              "options": [{ "text": "string" }],
              "attempted": false,
              "userSelectedOptionIndexes": [],
              "isCorrect": false,
              "correctOptionIndexes": []
            }
          ]
        }
      }
    ]
  }
}
```

> `correctOptionIndexes` is only included in a question when the user answered it **incorrectly**. It is omitted for unattempted or correctly-answered questions.

> Chapter `percentCompleted` = average of `lessonsPercentWatched` and `quizAttemptedPercent` if both exist; otherwise the single present component.

---

### POST /api/courses/:id/save

**Purpose:** Bookmark or un-bookmark a course for the current user. Idempotent.

**Required permission:** `course:view` (all roles)

#### Request Body

```json
{ "save": true }
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `save` | boolean | ✅ | Must be boolean |

#### Response `200`

```json
{
  "data": {
    "courseId": "string",
    "saved": true,
    "_id": "string"
  }
}
```

> Idempotent: saving an already-saved course returns `200` (not `409`). Unsaving a non-saved course also returns `200`.

---

### POST /api/courses/:id/resources/upload

**Purpose:** Upload up to 10 resource files (PDF, video, image, etc.) to a course.

**Required permission:** `course:create` (admin, trainer)

**Ownership:** Admin or owner only.

**Content-Type:** `multipart/form-data`, field `files[]`, max 20 files per request.

**Limits:**
- Total resources per course: 10 (hard cap, checked before upload)
- Per-file size cap: 2 GB

#### Response `200`

```json
{
  "data": {
    "added": [
      {
        "name": "string",
        "url": "string",
        "cloudinaryId": "string",
        "mimeType": "string",
        "sizeBytes": 0
      }
    ],
    "skippedTooLarge": [{ "name": "string", "sizeBytes": 0 }],
    "failed": [{ "name": "string", "error": "string" }]
  }
}
```

> Upload is parallel (`Promise.all`). Partial success is allowed — some files may succeed while others fail. The course is saved only with the files that succeeded.

---

### DELETE /api/courses/:id/resources/:resourceIndex

**Purpose:** Delete a single resource by zero-based index.

**Required permission:** `course:create` (admin, trainer)

**Ownership:** Admin or owner only.

#### Response `200`

```json
{
  "data": {
    "resourceIndex": 0,
    "deleted": { "name": "string", "cloudinaryId": "string" },
    "remainingCount": 0
  }
}
```

---

### POST /api/courses/:courseId/chapters

**Purpose:** Append a new empty chapter to a course.

**Required permission:** `course:create` (admin, trainer)

**Ownership:** Admin or owner only.

#### Request Body

```json
{ "title": "string" }
```

#### Response `201`

The newly created chapter object (with generated `_id`).

---

### DELETE /api/courses/:courseId/chapters/:chapterIndex

**Purpose:** Remove a chapter by zero-based index.

**Required permission:** `course:create` (admin, trainer)

**Ownership:** Admin or owner only.

#### Side Effects

- All lesson videos in the chapter are destroyed in Cloudinary.
- `recomputeCourseStats` runs synchronously.

#### Response `200`

```json
{ "data": { "chapterIndex": 0, "chapterId": "string" } }
```

---

### POST /api/courses/:courseId/chapters/:chapterIndex/lessons

**Purpose:** Add or replace the lesson in a chapter. Each chapter supports exactly one lesson.

**Required permission:** `course:create` (admin, trainer)

**Ownership:** Admin or owner only.

#### Request Body

| Field | Type | Required | Constraints |
|---|---|---|---|
| `title` | string | ✅ | — |
| `description` | string | ❌ | — |
| `videos` | array | ❌ | Each item must have `cloudinaryUrl` and `cloudinaryId` |

#### Response `201` (new lesson) / `200` (updated)

The lesson object.

#### Side Effects

- `recomputeCourseStats` runs synchronously.
- `enqueueCourseSubtitleJobs` fires asynchronously.

---

### DELETE /api/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex

**Purpose:** Delete a lesson and its videos by index.

**Required permission:** `course:create` (admin, trainer)

**Ownership:** Admin or owner only.

#### Side Effects

All lesson videos are destroyed in Cloudinary (errors suppressed).

#### Response `200`

```json
{ "data": { "chapterIndex": 0, "lessonIndex": 0 } }
```

---

### POST /api/courses/:courseId/chapters/:chapterIndex/quizzes

**Purpose:** Add or replace the quiz in a chapter. Each chapter supports exactly one quiz.

**Required permission:** `course:create` (admin, trainer)

**Ownership:** Admin or owner only.

#### Request Body

| Field | Type | Required | Constraints |
|---|---|---|---|
| `title` | string | ✅ (on create) | — |
| `questions` | array | ❌ | See question schema below |

**Question Schema:**

| Field | Type | Required | Constraints |
|---|---|---|---|
| `type` | `single` \| `multiple` | ✅ | `single` requires exactly 1 correct index |
| `prompt` | string | ✅ | Non-empty |
| `options` | `{ text: string }[]` | ✅ | Min 1 option |
| `correctOptionIndexes` | number[] | ✅ | Min 1 index; must be valid option indexes |

#### Response `201` (new) / `200` (updated)

The quiz object with questions.

---

### DELETE /api/courses/:courseId/chapters/:chapterIndex/quizzes/:quizIndex

**Purpose:** Delete a quiz from a chapter by index.

**Required permission:** `course:create` (admin, trainer)

**Ownership:** Admin or owner only.

#### Response `200`

```json
{ "data": { "chapterIndex": 0, "quizIndex": 0 } }
```

---

### PATCH /api/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/video

**Purpose:** Legacy video upsert. Client provides Cloudinary metadata after uploading externally. Prefer V1 signed-upload flow for new integrations.

**Required permission:** `course:create` implied (no `userHasPermission` check — ownership determined from course owner only, no explicit role gating).

#### Request Body

| Field | Type | Required | Constraints |
|---|---|---|---|
| `cloudinaryUrl` | string | ✅ | — |
| `cloudinaryId` | string | ✅ | — |
| `durationSeconds` | number | ❌ | ≥ 0 |
| `thumbnailUrl` | string | ❌ | Falls back to Cloudinary auto-generated frame |
| `title` | string | ❌ | — |
| `description` | string | ❌ | — |

#### Response `200`

```json
{ "data": { "video": { ... } } }
```

#### Side Effects

- Preserves subtitle tracks if same `cloudinaryId` is re-saved; resets subtitle pipeline for new video.
- `recomputeCourseStats` runs synchronously.
- `enqueueCourseSubtitleJobs` fires asynchronously.

---

### DELETE /api/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/videos/:videoIndex

**Purpose:** Delete a specific lesson video by index.

**Required permission:** `course:create` (admin, trainer)

**Ownership:** Admin or owner only.

#### Side Effects

Video is destroyed in Cloudinary. `recomputeCourseStats` runs synchronously.

#### Response `200`

```json
{ "data": { "chapterIndex": 0, "lessonIndex": 0, "videoIndex": 0 } }
```

---

### PUT /api/courses/:courseId/chapters/:chapterId/lessons/progress

**Purpose:** Record watch time for a lesson (always lesson index 0).

**Authentication:** Session required. No `userHasPermission` check.

#### Request Body

```json
{ "watchedSeconds": 360 }
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `watchedSeconds` | number | ✅ | ≥ 0 |

**Idempotency:** `watchedSeconds` is only updated if the new value is greater than the stored value (monotonically increasing).

**Completion threshold:** A lesson is marked `completed` when `percentWatched ≥ 90%` or `watchedSeconds ≥ durationSeconds`.

#### Response `200`

```json
{
  "data": {
    "watchedSeconds": 360,
    "completed": false,
    "percentWatched": 72.0,
    "durationSeconds": 500
  }
}
```

---

### POST /api/courses/:courseId/chapters/:chapterId/quiz/responses

**Purpose:** Submit quiz answers for a chapter.

**Required permission:** `course:view` (all roles)

**Access:** Admin and owner bypass status check. Others require `status: published`.

#### Request Body

```json
{
  "answers": [
    { "questionIndex": 0, "selectedOptionIndexes": [1] }
  ]
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `answers` | array | ✅ | Non-empty |
| `answers[].questionIndex` | number | ✅ | 0-based, within question count |
| `answers[].selectedOptionIndexes` | number[] | ✅ | Valid option indexes; `single` requires exactly 1 |

#### Response `201`

The `QuizResponse` document with `isCorrect` per answer.

---

### PUT /api/admin/change-status-course/:id

**Purpose:** Update the lifecycle status of a course.

**Access:**

| Role | Allowed target statuses |
|---|---|
| admin | `draft`, `pending`, `published`, `rejected` |
| trainer, trainee | `draft`, `pending` (own courses implied by business intent) |
| user | ❌ (403) |

#### Request Body

```json
{ "status": "published", "rejectReason": "" }
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `status` | string | ✅ | One of `draft`, `pending`, `published`, `rejected` |
| `rejectReason` | string | Conditional | Required and non-empty when `status: "rejected"` |

#### Side Effects

- Pushes FCM/Expo push notification to course owner.
- Creates in-app `Notification` record for course owner.

#### Response `200`

Updated course document.

---

### POST /api/courses/videos-upload

**Purpose:** Legacy endpoint — validates and echoes Cloudinary video metadata. No database writes.

**Required permission:** `course:create` (admin, trainer)

#### Request Body

```json
{
  "cloudinaryUrl": "string",
  "cloudinaryId": "string",
  "thumbnailUrl": "string",
  "durationSeconds": 120
}
```

#### Response `200`

Echoes the input fields back unchanged.

---

### POST /api/courses/delete-cloudinary-video

**Purpose:** Direct Cloudinary asset deletion by public ID.

**Access:** Admin or trainer only (manual role check, no `userHasPermission`).

#### Request Body

```json
{ "publicId": "string", "resourceType": "video" }
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `publicId` | string | ✅ | Cloudinary public_id |
| `resourceType` | string | ❌ | Default: `video` |

#### Response `200`

Cloudinary destroy result.

---

### POST /api/courses/:courseId/retry-subtitles

**Purpose:** Re-queue failed subtitle generation jobs for a course.

Handled by `retryCourseSubtitles` controller (separate file).

**Access:** Admin or trainer (enforced in that controller).

---

## 6. V1 Signed Upload Flow

### Overview

The V1 flow removes the trust requirement on the client to supply Cloudinary metadata. The backend signs the upload directly and the webhook delivers verified metadata.

**Flow:**

```
Client                    Backend                       Cloudinary
  |                          |                               |
  |-- POST signed-upload-url -->|                            |
  |<-- { uploadUrl, fields } --|                            |
  |                          |                               |
  |-- PUT uploadUrl (multipart) --------------------------->|
  |<-- { secure_url, public_id, duration } ----------------|
  |                          |                               |
  |                          |<-- POST /webhooks/upload-complete
  |                          |    (notification_url callback)
  |                          |-- verify HMAC signature       |
  |                          |-- update Course document      |
  |                          |-- enqueue CourseSubtitleJob   |
  |                          |                               |
  |-- GET video-status ------>|                             |
  |<-- { videoReady, cloudinaryId, durationSeconds } -------|
```

---

### POST /api/v1/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/signed-upload-url

**Purpose:** Issue a Cloudinary signed upload URL for a specific lesson video slot.

**Required session:** Yes

**Ownership:** Admin or course owner only.

#### Path Parameters

| Parameter | Type | Constraints |
|---|---|---|
| `courseId` | string | Valid MongoDB ObjectId |
| `chapterIndex` | integer | ≥ 0, chapter must exist |
| `lessonIndex` | integer | ≥ 0, lesson must exist |

#### Response `200`

```json
{
  "data": {
    "uploadUrl": "https://api.cloudinary.com/v1_1/{cloudName}/video/upload",
    "fields": {
      "api_key": "string",
      "timestamp": 1700000000,
      "signature": "string",
      "public_id": "course-videos/{courseId}/{chapterIndex}/{lessonIndex}/{timestamp}",
      "notification_url": "{BETTER_AUTH_URL}/api/v1/webhooks/cloudinary/upload-complete",
      "resource_type": "video"
    }
  }
}
```

**Signed parameters:** `notification_url`, `public_id`, `timestamp`. HMAC-SHA1 via `cloudinary.utils.api_sign_request`.

**Client upload:** `multipart/form-data` POST to `uploadUrl` with all `fields` plus the video file.

---

### GET /api/v1/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/video-status

**Purpose:** Poll for video upload completion after the webhook has fired.

**Required session:** Yes

**Ownership:** Admin or course owner only.

#### Response `200`

```json
{
  "data": {
    "courseId": "string",
    "chapterIndex": 0,
    "lessonIndex": 0,
    "videoReady": true,
    "cloudinaryId": "course-videos/.../...",
    "durationSeconds": 120,
    "subtitleStatus": "pending|done|failed|null"
  }
}
```

`videoReady` is `true` when `lesson.videos[0].cloudinaryId` is populated.

---

### Webhook: POST /api/v1/webhooks/cloudinary/upload-complete

**Purpose:** Cloudinary fires this when the direct upload finishes.

**Authentication:** HMAC-SHA1 signature verified via `x-cld-signature` + `x-cld-timestamp` headers using `cloudinary.utils.verifyNotificationSignature`. Returns `401` on failure.

**Routing by `public_id` prefix:**

| Prefix | Handler |
|---|---|
| `course-videos/` | `handleCourseVideoUpload` — updates chapter lesson video, enqueues `CourseSubtitleJob` |
| `short-videos/` | Short video handler (separate domain) |

**`public_id` format for courses:** `course-videos/{courseId}/{chapterIndex}/{lessonIndex}/{timestamp}`

**Subtitle job:** Enqueued with `not_before = now + 2 minutes` to allow Cloudinary transcoding to complete before the caption worker picks it up.

> Always returns `200` regardless of processing errors to prevent Cloudinary from retrying.

---

## 7. Security Considerations

### Input Validation

- All MongoDB ID parameters validated with `mongoose.Types.ObjectId.isValid()` before queries.
- Numeric indexes cast via `Number()` and validated with `Number.isInteger()` + non-negative check.
- Enum fields (`status`, `accessLevel`, `visibility`) validated against explicit allowlists.
- Tag slugs resolved against the database — unknown slugs are rejected or silently dropped depending on context.

### File Upload Security

- Thumbnail upload validates `file.mimetype.startsWith("image/")`.
- Resource uploads use `resource_type: "auto"` — Cloudinary determines type.
- Max file size enforced server-side before streaming to Cloudinary.

### Webhook Integrity

- Cloudinary webhook payloads verified via HMAC-SHA1 before any database writes.
- Raw request body preserved (`req.rawBody`) before `express.json()` parsing to ensure signature verification uses the exact signed bytes.

### Least-Privilege Enforcement

- `user` role is blocked from the management list (`GET /courses`) via `courseVideoStatus:view` permission.
- `user` role reads are gated by both `visibility` and `accountType` accessLevel.
- Status transitions to `published` require admin role; trainer/trainee can only move to `draft` or `pending`.
- `deleteCloudinaryVideo` restricted to admin and trainer via explicit role check (no permission system).

### Session Management

- Sessions retrieved via `auth.api.getSession({ headers: fromNodeHeaders(req.headers) })`.
- `apiHeaders` cached once per request — not re-derived per call.

---

## 8. Performance & Observability

### Caching

No response-level caching is implemented. Cloudinary-delivered media (HLS, thumbnails) is cached at the CDN layer.

### Time Complexity Hotspots

| Endpoint | Concern |
|---|---|
| `GET /courses/completed` | Fetches ALL matching published courses into memory before computing completion. Will degrade at scale — convert to aggregation pipeline. |
| `GET /courses/saved-course` | Same in-memory pagination pattern. |
| `GET /courses/:id/progress` | O(chapters × lessons) quiz response merge. Linear and bounded by course size. |
| `POST /courses/:id/resources/upload` | All files uploaded in parallel. CPU/memory bounded by `limit: 20` file count. |

### Observability

All significant operations emit structured log entries via the `logger` utility:

- `[CourseSubtitles]` — subtitle job enqueue events with course ID and job count.
- `[CourseVideosV1]` — signed URL generation, per course/chapter/lesson.
- `[CloudinaryUploadV1]` — webhook receive, routing decision, course update, subtitle job enqueue.
- Cloudinary deletion failures logged at `warn` level (non-fatal, operations continue).
- Push notification failures logged at `error` level (non-fatal).
- Unhandled errors forwarded to Express error middleware via `next(error)`.

### Scalability Notes

- `enqueueCourseSubtitleJobs` uses MongoDB `bulkWrite` with `upsert: true` for idempotent job creation.
- `CourseSubtitleJob` has a compound unique index on `(courseId, cloudinaryId)` preventing duplicate enqueues.
- Parallel Cloudinary uploads in `uploadCourseResources` use `Promise.all` — all uploads start concurrently and failures are collected without blocking successful uploads.
- `recomputeCourseStats` is O(chapters × lessons × videos) and runs synchronously on every mutating save. For courses with many chapters, consider offloading to a post-save hook.
