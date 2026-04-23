# Course Content Management API

The Course Content Management API enables authenticated users to create and manage courses, chapters, lessons, videos, quizzes, learning resources, and progress. It also supports saving courses, computing progress summaries, and administrative moderation (status changes). Tag listing is included because tags are used for filtering courses.

## Overview
- Purpose: Manage video-based courses and their learning artifacts; track learner progress; support admin publishing workflow.
- Primary actors: admin, trainer (course creator/owner), and general users.
- Core capabilities:
  - Create/update/delete courses and course media (thumbnail, lesson videos)
  - Manage chapters, lessons, quizzes, and course resources
  - Save/unsave courses; fetch saved/published/completed lists
  - Update/view per-lesson progress; aggregate course-level progress
  - Moderate course status (draft/pending/published/rejected)
  - List tags used for filtering

## Base URL
- Assumption: API is served under `/api/content-management`. All paths below are relative to this base.
- Example full URL: `https://your-domain.example/api/content-management/courses`

## Authentication
- Method: Bearer token in the `Authorization` header
- RBAC: Role and permission checks are enforced per endpoint
- Example headers:

```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

- Admin-only routes are explicitly noted. Trainer routes require the user to be the course owner.

## Response Envelope
- Success:

```json
{
  "success": true,
  "message": "Human-readable message",
  "data": { "any": "endpoint-specific payload" },
  "meta": { "optional": "endpoint-specific metadata (e.g., pagination)" }
}
```

- Error:

```json
{
  "success": false,
  "message": "Error message",
  "errors": { "optional": "extra error details" }
}
```

---

## Endpoints

### Create Course
- Method: POST
- Path: `/courses`
- Description: Create a new course with optional thumbnail upload.
- AuthZ: Requires permission `course:create`. Only authenticated users.
- Request headers:
  - `Authorization: Bearer <token>`
  - `Content-Type: multipart/form-data` (to upload thumbnail via field `thumbnail`) or `application/json` (if only metadata)
- Request body (multipart or JSON):
  - `title` (string, required)
  - `description` (string, required)
  - `tags` (string[] or comma-separated string, optional). Unknown tags are ignored at creation time; only existing active tag slugs are kept.
  - `status` ("draft" | "pending" | "published", optional; default "draft")
  - `accessLevel` ("free" | "develop" | "master", optional; default "free")
  - `thumbnailUrl` (string, optional; used if not uploading a file)
  - `visibility` ("clinicians" | "users" | "all", optional; default "users")
  - `thumbnail` (file, optional; image only; max size 100MB)
- Example request (JSON):

```json
{
  "title": "Intro to Cardiology",
  "description": "Foundational course for clinicians.",
  "tags": ["cardiology", "basics"],
  "status": "pending",
  "accessLevel": "free",
  "thumbnailUrl": "https://cdn.example/thumb.jpg",
  "visibility": "clinicians"
}
```

- Success response (201):
  - Message: "Course created"
  - Data: Course

```json
{
  "success": true,
  "message": "Course created",
  "data": {
    "_id": "67a1c...e91",
    "title": "Intro to Cardiology",
    "description": "Foundational course for clinicians.",
    "tags": ["cardiology", "basics"],
    "status": "pending",
    "rejectReason": "",
    "accessLevel": "free",
    "visibility": "clinicians",
    "user": "67a0...b2f",
    "createdBy": { "_id": "67a0...b2f", "name": "Alice", "email": "alice@example.com" },
    "thumbnailUrl": "https://cdn.example/thumb.jpg",
    "thumbnailCloudinaryId": "",
    "chapters": [],
    "resources": [],
    "totalDurationSeconds": 0,
    "totalQuizzes": 0,
    "totalChapters": 0,
    "createdAt": "2026-02-06T12:00:00.000Z",
    "updatedAt": "2026-02-06T12:00:00.000Z"
  }
}
```

- Error responses:

| Status | Message                                | Meaning                                   | Sample payload |
|--------|----------------------------------------|-------------------------------------------|----------------|
| 401    | Unauthorized                           | Missing/invalid session                   | `{"success":false,"message":"Unauthorized"}` |
| 403    | Forbidden: insufficient permissions    | Lacking `course:create`                   | `{"success":false,"message":"Forbidden: insufficient permissions"}` |
| 400    | Title and description are required.    | Missing required fields                    | `{"success":false,"message":"Title and description are required."}` |
| 400    | Invalid thumbnail file type            | Non-image file for `thumbnail`            | `{"success":false,"message":"Invalid thumbnail file type"}` |
| 400    | Thumbnail size exceeds 100 MB          | File too large                            | `{"success":false,"message":"Thumbnail size exceeds 100 MB"}` |
| 400    | Invalid visibility                     | Visibility not in allowed set             | `{"success":false,"message":"Invalid visibility"}` |
| 500    | Failed to upload thumbnail to Cloudinary | Cloudinary upload error                 | `{"success":false,"message":"Failed to upload thumbnail to Cloudinary"}` |

---

### List All Courses (admin/trainer-aware)
- Method: GET
- Path: `/courses`
- Description: Paginated list of courses visible per role and optional status/tag/search filters.
- AuthZ: Requires permission `courseVideoStatus:view`.
- Request headers:
  - `Authorization: Bearer <token>`
- Query parameters:
  - `limit` (number, optional; default 10; min 1)
  - `page` (number, optional; default 1; min 1)
  - `status` ("draft" | "pending" | "published" | "rejected", optional)
  - `tags` or `tag` (string[] or comma-separated string; filters to existing active tag slugs; invalid slugs cause 400)
  - `q` (string; case-insensitive title/description search)
  - Sorting:
    - `sortBy` or `by` ("createdAt" | "title" | "tags"; default "createdAt")
    - `order` or `sort` ("asc" | "desc" | "dsc"; default "desc")
- Success response (200):
  - Message: "Courses fetched"
  - Data: array of courses; If a course lacks `thumbnailUrl`, the API attempts to derive one from lesson videos.
  - Meta: `{ page, offset, limit, total, hasNext }`

```json
{
  "success": true,
  "message": "Courses fetched",
  "data": [
    {
      "_id": "67a1c...e91",
      "title": "Intro to Cardiology",
      "description": "Foundational course for clinicians.",
      "tags": ["cardiology","basics"],
      "status": "published",
      "accessLevel": "free",
      "createdAt": "2026-02-01T12:00:00.000Z",
      "updatedAt": "2026-02-05T12:00:00.000Z",
      "user": "67a0...b2f",
      "createdBy": { "_id": "67a0...b2f", "name": "Alice", "email": "alice@example.com" },
      "chapters": [],
      "thumbnailUrl": "https://cdn.example/thumb.jpg",
      "totalDurationSeconds": 1200,
      "totalQuizzes": 2,
      "totalChapters": 3
    }
  ],
  "meta": { "page": 1, "offset": 0, "limit": 10, "total": 1, "hasNext": false }
}
```

- Error responses:

| Status | Message                              | Meaning                                              |
|--------|--------------------------------------|------------------------------------------------------|
| 401    | Unauthorized                         | Missing/invalid session                              |
| 403    | Forbidden: insufficient permissions  | Lacking `courseVideoStatus:view`                     |
| 400    | Invalid status filter                | `status` not in allowed set                          |
| 400    | Invalid tag filter: unknown tags     | Tag slugs not found among active tags                |

Role-aware visibility (summary):
- Admin: can view own drafts, all pending/published, and rejected if explicitly requested via `status=rejected`.
- Trainer: can view own courses (draft/pending/published). If `status=published`, shows published only.
- Others: no data (`visibilityFilter` denies).

---

### List Published Courses (current user)
- Method: GET
- Path: `/courses/published-videos`
- Description: Paginated, filterable list of published courses accessible to the current user with progress summary and saved indicator.
- AuthZ: Requires permission `course:view`.
- Query parameters:
  - `limit`, `page` (pagination; defaults as above)
  - `tags`/`tag` and `q` (filters; same rules as above)
  - Sorting: `sortBy`/`by` and `order`/`sort` (same rules)
- Success response (200):
  - Message: "Published courses fetched"
  - Data: array of objects including `progressSummary` and `saved`

```json
{
  "success": true,
  "message": "Published courses fetched",
  "data": [
    {
      "_id": "67a1c...e91",
      "title": "Intro to Cardiology",
      "description": "Foundational course for clinicians.",
      "tags": ["cardiology","basics"],
      "status": "published",
      "accessLevel": "free",
      "visibility": "clinicians",
      "createdAt": "2026-02-01T12:00:00.000Z",
      "updatedAt": "2026-02-05T12:00:00.000Z",
      "user": "67a0...b2f",
      "createdBy": { "_id": "67a0...b2f", "name": "Alice", "email": "alice@example.com" },
      "thumbnailUrl": "https://cdn.example/thumb.jpg",
      "totalDurationSeconds": 1200,
      "totalQuizzes": 2,
      "chapters": [],
      "saved": true,
      "progressSummary": {
        "percentCompleted": 42.5,
        "completed": false
      }
    }
  ],
  "meta": { "page": 1, "offset": 0, "limit": 10, "total": 1, "hasNext": false }
}
```

- Errors: same as List All Courses plus standard 401/403.

---

### List Completed Courses (current user)
- Method: GET
- Path: `/courses/completed`
- Description: Paginated list of published courses where the user’s computed progress indicates completion (≥90%).
- AuthZ: Requires permission `course:view`.
- Query parameters: `limit`, `page`, `tags`/`tag`, `q`, `sortBy`/`by`, `order`/`sort` (same rules).
- Success response (200):
  - Message: "Completed courses fetched"
  - Data: array of course objects with `progressSummary` (watchedSeconds, percentWatched, completed, durationSeconds).
  - Meta: `{ page, offset, limit, total, hasNext }`

- Error responses: standard 401/403 and `400 Invalid tag filter` when applicable.

---

### List Saved Courses (current user)
- Method: GET
- Path: `/courses/saved-course`
- Description: Paginated list of courses the user has saved/bookmarked, preserving saved order (latest first), with progress summary.
- AuthZ: Requires permission `course:view`.
- Query parameters: `limit`, `page`.
- Success response (200):
  - Message: "Saved courses fetched"
  - Data: array of course objects with `progressSummary`
  - Meta: `{ page, offset, limit, total, hasNext }`

---

### Get Course
- Method: GET
- Path: `/courses/:id`
- Description: Fetch a single course. Non-owner non-admin users can only access `published` courses and must pass visibility checks.
- AuthZ: Requires permission `course:view`.
- Path parameters:
  - `id` (string; Course ObjectId)
- Success response (200):
  - Message: "Course fetched"
  - Data: Course document
- Error responses:

| Status | Message                              | Meaning                                  |
|--------|--------------------------------------|------------------------------------------|
| 401    | Unauthorized                         | Missing/invalid session                  |
| 403    | Forbidden: visibility not allowed    | Role/visibility check failed             |
| 403    | Forbidden: course not accessible     | Non-owner/admin accessing non-published  |
| 404    | Course not found                     | Invalid id or missing course             |

---

### Update Course
- Method: PATCH
- Path: `/courses/:id`
- Description: Update course metadata, tags, visibility, status, chapters, and/or thumbnail.
- AuthZ: Requires permission `course:create` and user must be admin or course owner.
- Request headers:
  - `Authorization: Bearer <token>`
  - `Content-Type: multipart/form-data` (to upload new thumbnail) or `application/json`
- Path parameters:
  - `id` (string; Course ObjectId)
- Request body:
  - `title` (string, optional)
  - `description` (string, optional)
  - `tags` (string[] or comma-separated string, optional). Validation: if provided and non-empty after parsing, all slugs must exist among active tags; otherwise `400 Invalid tags: provide existing tag slugs`.
  - `accessLevel` ("free" | "develop" | "master", optional)
  - `visibility` ("clinicians" | "users" | "all", optional)
  - `status` ("draft" | "pending" | "published", optional; "published" requires admin)
  - `chapters` (array, optional; full structure replacement)
  - `thumbnailUrl` (string, optional). Setting `""` clears and deletes prior Cloudinary image if any.
  - `thumbnail` (file, optional; image only; max size 100MB)
- Success response (200):
  - Message: "Course updated"
  - Data: Course document
- Error responses include: 401, 403 (not owner/admin or trying to set `published` as non-admin), 400 (invalid types, accessLevel/visibility/status), 404 (course not found), 500 (thumbnail upload failure).

---

### Delete Course
- Method: DELETE
- Path: `/courses/:id`
- Description: Delete a course. Also attempts to clean up Cloudinary assets (lesson videos, thumbnail, resource folder).
- AuthZ: Admin or owner.
- Path parameters:
  - `id` (string; Course ObjectId)
- Success response (200):
  - Message: "Course deleted"
  - Data: `{ "id": "<courseId>" }`
- Error responses:
  - 401 Unauthorized
  - 403 Forbidden: only admin or owner can delete
  - 404 Course not found
  - 500 Failed to delete course from database

---

### Delete Course Thumbnail
- Method: DELETE
- Path: `/courses/:id/thumbnail`
- Description: Delete the course thumbnail and clear associated Cloudinary ID if present.
- AuthZ: Admin or owner.
- Path parameters:
  - `id` (string; Course ObjectId)
- Success response (200):
  - Message: "Thumbnail deleted"
  - Data: Course document
- Error responses: 401, 403, 404 Course not found

---

### Get Course With Progress
- Method: GET
- Path: `/courses/:id/progress`
- Description: Fetch course chapters with per-lesson and per-question user progress/attempts merged for the current user.
- AuthZ: Requires permission `course:view`. Non-owner non-admin requires course to be `published`.
- Path parameters:
  - `id` (string; Course ObjectId)
- Success response (200):
  - Message: "Course with progress"
  - Data:

```json
{
  "courseId": "67a1c...e91",
  "title": "Intro to Cardiology",
  "createdBy": { "_id": "67a0...b2f", "name": "Alice", "email": "alice@example.com" },
  "chapters": [
    {
      "chapterId": "67a1c...aa0",
      "chapterIndex": 0,
      "title": "Basics",
      "lessons": [
        {
          "lessonIndex": 0,
          "title": "Fundamentals",
          "videos": [
            {
              "cloudinaryUrl": "https://res.cloudinary.com/.../video/upload/v...",
              "cloudinaryId": "course_videos/abc123",
              "durationSeconds": 600,
              "thumbnailUrl": "https://res.cloudinary.com/.../image/upload/v..."
            }
          ],
          "durationSeconds": 600,
          "watchedSeconds": 240,
          "percentWatched": 40.0,
          "completed": false
        }
      ],
      "quiz": {
        "title": "Chapter quiz",
        "attempted": true,
        "questions": [
          {
            "questionIndex": 0,
            "type": "single",
            "prompt": "Which is true?",
            "options": [{"text":"A"},{"text":"B"}],
            "attempted": true,
            "userSelectedOptionIndexes": [0],
            "isCorrect": true
          }
        ],
        "attemptedCount": 1,
        "totalQuestions": 10,
        "attemptedPercent": 10.0
      },
      "durationSeconds": 600,
      "watchedSeconds": 240,
      "lessonsPercentWatched": 40.0,
      "quizAttemptedPercent": 10.0,
      "percentCompleted": 25.0
    }
  ]
}
```

- Error responses: 401, 403 visibility, 404 course/chapter not found

---

### Save or Unsave Course
- Method: POST
- Path: `/courses/:id/save`
- Description: Save/bookmark or unsave a course for the current user.
- AuthZ: Requires permission `course:view`. Non-owner non-admin can only save `published` courses.
- Path parameters:
  - `id` (string; Course ObjectId)
- Request body:
  - `save` (boolean, required). `true` saves; `false` unsaves.
- Success responses (200):
  - "Course saved" or "Course already saved" — Data: `{ "courseId": "<id>", "saved": true, "_id": "<savedDocId>" }`
  - "Course unsaved" or "Course already unsaved" — Data: `{ "courseId": "<id>", "saved": false }`
- Error responses: 401, 403, 404 Course not found, 400 Invalid request: 'save' boolean is required

---

### Upload Course Resources (files)
- Method: POST
- Path: `/courses/:id/resources/upload`
- Description: Upload up to 20 resources (files) to Cloudinary and attach them to the course.
- AuthZ: Admin or owner; requires permission `course:create`.
- Request headers:
  - `Content-Type: multipart/form-data`
- Path parameters:
  - `id` (string; Course ObjectId)
- Form fields:
  - `files` (array of files; max 20; each ≤ 2GB; `resource_type: auto`)
- Success response (200):
  - Message: "Resources uploaded"
  - Data:

```json
{
  "added": [
    {
      "name": "handout.pdf",
      "url": "https://res.cloudinary.com/.../raw/upload/v.../courses/<id>/resources/handout.pdf",
      "cloudinaryId": "courses/<id>/resources/xyz",
      "mimeType": "application/pdf",
      "sizeBytes": 102400
    }
  ],
  "skippedTooLarge": [],
  "failed": []
}
```

- Error responses: 401, 403, 404 Course not found, 400 No files provided

---

### Delete Course Resource
- Method: DELETE
- Path: `/courses/:id/resources/:resourceIndex`
- Description: Delete a resource by its index from the course; attempts Cloudinary cleanup when `cloudinaryId` is present.
- AuthZ: Admin or owner; requires permission `course:create`.
- Path parameters:
  - `id` (string; Course ObjectId)
  - `resourceIndex` (number; ≥0)
- Success response (200):
  - Message: "Resource deleted"
  - Data: `{ "resourceIndex": 0, "deleted": { "name": "handout.pdf", "cloudinaryId": "..." }, "remainingCount": 3 }`
- Error responses: 401, 403, 404 Course/Resource not found, 400 Invalid resourceIndex

---

### Add Chapter
- Method: POST
- Path: `/courses/:courseId/chapters`
- Description: Add a chapter to a course.
- AuthZ: Admin or owner; requires permission `course:create`.
- Path parameters:
  - `courseId` (string; Course ObjectId)
- Request body:
  - `title` (string, required)
- Success response (201):
  - Message: "Chapter added"
  - Data: `{ "_id": "<chapterId>", "title": "Basics", "lessons": [], "quizzes": [] }`
- Error responses: 401, 403, 404 Course not found, 400 Chapter title is required

---

### Delete Chapter
- Method: DELETE
- Path: `/courses/:courseId/chapters/:chapterIndex`
- Description: Delete a chapter by index; attempts Cloudinary cleanup for all lesson videos within the chapter.
- AuthZ: Admin or owner; requires permission `course:create`.
- Path parameters:
  - `courseId` (string; Course ObjectId)
  - `chapterIndex` (number; ≥0)
- Success response (200):
  - Message: "Chapter deleted"
  - Data: `{ "chapterIndex": 0, "chapterId": "<chapterId>" }`
- Error responses: 401, 403, 404 Course/Chapter not found, 400 Invalid chapterIndex

---

### Add or Update Lesson (first lesson in chapter)
- Method: POST
- Path: `/courses/:courseId/chapters/:chapterIndex/lessons`
- Description: Add or update the first lesson in the chapter, including its videos.
- AuthZ: Admin or owner; requires permission `course:create`.
- Path parameters:
  - `courseId` (string)
  - `chapterIndex` (number; ≥0)
- Request body:
  - `title` (string, required)
  - `description` (string, optional)
  - `videos` (array, optional), each item:
    - `cloudinaryUrl` (string, required)
    - `cloudinaryId` (string, required)
    - `durationSeconds` (number, optional; default 0; ≥0)
    - `thumbnailUrl` (string, optional)
- Success responses:
  - (201) "Lesson added" — Data: lesson object
  - (200) "Lesson updated" — Data: updated lesson object
- Error responses: 401, 403, 404 Course/Chapter not found, 400 invalid payload (missing required video fields)

---

### Add or Update Quiz (first quiz in chapter)
- Method: POST
- Path: `/courses/:courseId/chapters/:chapterIndex/quizzes`
- Description: Add or update the first quiz in the chapter.
- AuthZ: Admin or owner; requires permission `course:create`.
- Path parameters:
  - `courseId` (string)
  - `chapterIndex` (number; ≥0)
- Request body:
  - `title` (string, required when creating)
  - `questions` (array, optional; when provided, replaces existing). Each question:
    - `type` ("single" | "multiple", required)
    - `prompt` (string, required)
    - `options` (array of `{ text: string }`, required; at least 1)
    - `correctOptionIndexes` (array<number>, required; indexes must be within options; unique; for `single` exactly 1, for `multiple` ≥1)
- Success responses:
  - (201) "Quiz added" — Data: quiz object
  - (200) "Quiz updated" — Data: updated quiz object
- Error responses: 401, 403, 404 Course/Chapter not found, 400 invalid question payload

---

### Update Lesson Video (by index)
- Method: PATCH
- Path: `/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/video`
- Description: Upsert the first video for the given lesson index; update lesson title/description optionally.
- AuthZ: Admin or owner; requires permission `course:create`.
- Path parameters:
  - `courseId` (string)
  - `chapterIndex` (number; ≥0)
  - `lessonIndex` (number; ≥0)
- Request body:
  - `cloudinaryUrl` (string, required)
  - `cloudinaryId` (string, required)
  - `durationSeconds` (number, optional; ≥0)
  - `thumbnailUrl` (string, optional)
  - `title` (string, optional)
  - `description` (string, optional)
- Success response (200):
  - Message: "Video added to lesson"
  - Data: `{ "video": { ... }, "thumbnailUrl": "..." }`
- Error responses: 401, 403, 404 Course/Chapter/Lesson not found, 400 invalid indexes or payload

---

### Delete Lesson Video
- Method: DELETE
- Path: `/courses/:courseId/chapters/:chapterIndex/lessons/:lessonIndex/videos/:videoIndex`
- Description: Delete a lesson video by its index; attempts Cloudinary cleanup for the video.
- AuthZ: Admin or owner; requires permission `course:create`.
- Path parameters:
  - `courseId` (string)
  - `chapterIndex` (number; ≥0)
  - `lessonIndex` (number; ≥0)
  - `videoIndex` (number; ≥0)
- Success response (200):
  - Message: "Lesson video deleted"
  - Data: `{ "chapterIndex": 0, "lessonIndex": 0, "videoIndex": 0 }`
- Error responses: 401, 403, 404 Course/Chapter/Lesson/Video not found, 400 invalid indexes

---

### Update Lesson Progress
- Method: PUT
- Path: `/courses/:courseId/chapters/:chapterId/lessons/progress`
- Description: Update watched time and completion state for the first lesson in the chapter for the current user.
- AuthZ: Requires permission `course:view`.
- Path parameters:
  - `courseId` (string; Course ObjectId)
  - `chapterId` (string; Chapter ObjectId)
- Request body:
  - `watchedSeconds` (number, optional; ≥0). When provided, updates watched time capped to lesson duration.
- Success response (200):
  - Message: "Lesson progress updated"
  - Data: `{ "watchedSeconds": 240, "completed": false, "percentWatched": 40.0, "durationSeconds": 600 }`
- Error responses: 401, 400 invalid IDs or watchedSeconds, 404 Course/Chapter/Lesson not found
- Assumption: One lesson per chapter is common; this endpoint targets lesson index 0.

---

### Submit Quiz Responses
- Method: POST
- Path: `/courses/:courseId/chapters/:chapterId/quiz/responses`
- Description: Submit quiz answers for the first quiz in a chapter; server validates and stores correctness.
- AuthZ: Requires permission `course:view`.
- Path parameters:
  - `courseId` (string; Course ObjectId)
  - `chapterId` (string; Chapter ObjectId)
- Request body:
  - `answers` (array, required) of:
    - `questionIndex` (number; ≥0; within quiz question count)
    - `selectedOptionIndexes` (array<number>; for `single` exactly 1; for `multiple` ≥1; all within options)
- Success response (201):
  - Message: "Quiz responses saved"
  - Data: QuizResponse document
- Error responses: 401, 403, 400 invalid IDs or answers, 404 Course/Chapter/Quiz not found

---

### Change Course Status (admin)
- Method: PUT
- Path: `/admin/change-status-course/:id`
- Description: Admin moderation of course status; optionally records a rejection reason and triggers notifications.
- AuthZ: Admin only.
- Path parameters:
  - `id` (string; Course ObjectId)
- Request body:
  - `status` ("draft" | "pending" | "published" | "rejected", required)
  - `rejectReason` (string, required when `status="rejected"`, non-empty)
- Success response (200):
  - Message: "Course status updated"
  - Data: Course document (with updated `status` and `rejectReason`)
- Error responses: 401, 403 admin-only, 400 invalid status / missing `rejectReason` when rejected, 404 Course not found

---

### Upload Lesson Video Metadata
- Method: POST
- Path: `/courses/videos-upload`
- Description: Accepts client-provided video metadata after uploading to Cloudinary; returns the same fields.
- AuthZ: Requires permission `course:create`.
- Request body:
  - `cloudinaryUrl` (string, required)
  - `cloudinaryId` (string, required)
  - `thumbnailUrl` (string, required)
  - `durationSeconds` (number, required; ≥0)
- Success response (200):
  - Message: "Video metadata received"
  - Data: `{ "cloudinaryUrl": "...", "cloudinaryId": "...", "durationSeconds": 600, "thumbnailUrl": "..." }`
- Error responses: 401, 403, 400 Missing required fields / invalid `durationSeconds`

---

### Delete Cloudinary Video
- Method: POST
- Path: `/courses/delete-cloudinary-video`
- Description: Delete a Cloudinary asset by its public ID; defaults to resource type `video`.
- AuthZ: Admin or trainer role.
- Request body:
  - `publicId` (string, required)
  - `resourceType` (string, optional; "video" | "image" | "raw"; default "video")
- Success response (200):
  - Message: "Video deleted successfully"
  - Data: Cloudinary deletion result
- Error responses: 401, 403 insufficient permissions, 400 `publicId` is required, 500 Failed to delete from Cloudinary

---

### List Tags (admin)
- Method: GET
- Path: `/admin/tags`
- Description: List all tags (active and inactive) sorted by `updatedAt` descending.
- AuthZ: Requires authenticated session.
- Success response (200):
  - Message: "Tags fetched"
  - Data: array of tag documents (`name`, `slug`, `active`, `createdBy`, `createdAt`, `updatedAt`)
- Error responses: 401 Unauthorized

---

## Data Models

### Course
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| _id | ObjectId | yes | |
| title | string | yes | default `""` |
| description | string | yes | default `""` |
| tags | string[] | no | tag slugs |
| status | "draft" | "pending" | "published" | "rejected" | yes | default `draft` |
| rejectReason | string | no | non-empty when `status="rejected"` |
| accessLevel | "free" | "develop" | "master" | yes | default `free` |
| visibility | "clinicians" | "users" | "all" | yes | default `users` |
| user | ObjectId(User) | yes | owner |
| createdBy | object | no | `{ _id, name, email }` |
| thumbnailUrl | string | no | |
| thumbnailCloudinaryId | string | no | |
| chapters | IChapter[] | no | default `[]` |
| resources | ICourseResource[] | no | default `[]` |
| totalDurationSeconds | number | yes | aggregated lesson durations + quiz weighting |
| totalQuizzes | number | yes | aggregated |
| totalChapters | number | yes | aggregated |
| createdAt | Date | yes | |
| updatedAt | Date | yes | |

### Chapter (embedded)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| _id | ObjectId | yes | generated for embedded chapter |
| title | string | yes | |
| lessons | ILesson[] | no | default `[]` |
| quizzes | IQuiz[] | no | default `[]` |

### Lesson (embedded)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| title | string | yes | |
| description | string | no | default `""` |
| videos | ILessonVideo[] | no | default `[]` |

### LessonVideo (embedded)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| cloudinaryUrl | string | yes | |
| cloudinaryId | string | yes | |
| durationSeconds | number | no | default `0`, min `0` |
| thumbnailUrl | string | no | |

### CourseResource (embedded)
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| name | string | yes | |
| url | string | yes | |
| cloudinaryId | string | no | |
| mimeType | string | no | |
| sizeBytes | number | no | min `0` |

### LessonVideoProgress
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| userId | ObjectId(User) | yes | unique constraint with course/chapter/lessonIndex |
| courseId | ObjectId(Course) | yes | |
| chapterId | ObjectId | yes | |
| lessonIndex | number | yes | min `0` |
| watchedSeconds | number | yes | default `0`, min `0` |
| videoWatchedSeconds | number[] | no | per-video watched map |
| completed | boolean | yes | default `false` |
| createdAt | Date | yes | |
| updatedAt | Date | yes | |

### QuizQuestion / QuizOption / Quiz
| Model | Fields |
|-------|--------|
| IQuizOption | `{ text: string }` |
| IQuizQuestion | `{ type: "single"|"multiple", prompt: string, options: IQuizOption[], correctOptionIndexes: number[] }` |
| IQuiz | `{ title: string, questions: IQuizQuestion[] }` |

### QuizResponse
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| userId | ObjectId(User) | yes | |
| courseId | ObjectId(Course) | yes | |
| chapterId | ObjectId | yes | |
| quizIndex | number | yes | default `0`, min `0` |
| answers | IQuizAnswer[] | yes | `questionIndex`, `selectedOptionIndexes`, `isCorrect?` |
| createdAt | Date | yes | |
| updatedAt | Date | yes | |

### SavedCourse
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| userId | string | yes | unique with `courseId` |
| courseId | string | yes | |
| createdAt | Date | yes | |
| updatedAt | Date | yes | |

### Tag
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| name | string | yes | |
| slug | string | yes | unique, lowercase |
| active | boolean | yes | default `true` |
| deletedAt | Date | no | TTL (~180 days) when set |
| createdBy | ObjectId(User) | yes | |
| createdAt | Date | yes | |
| updatedAt | Date | yes | |

---

## Validation Rules
- IDs must be valid MongoDB ObjectIds where applicable (`courseId`, `chapterId`).
- Indexes (`chapterIndex`, `lessonIndex`, `videoIndex`) are integers ≥ 0.
- `watchedSeconds` must be a non-negative number and is capped to lesson duration for percent calculations.
- Quiz validation:
  - `options` non-empty; `correctOptionIndexes` within bounds and unique
  - `single` type requires exactly one correct option; `multiple` requires ≥1
- Tags:
  - Creation: unknown tag inputs are ignored and not stored
  - Update/filtering: invalid tag slugs produce 400 errors
- `published` status can only be set by admin.
- Rejection requires non-empty `rejectReason`.

---

## Rate Limiting
- Assumption: No explicit per-endpoint rate limiting is implemented at the service level. Apply limits at gateway/reverse proxy as needed for production. 429 responses are not generated by this API unless enforced upstream.

---

## Pagination
- Query: `limit` (default 10), `page` (default 1)
- Response meta: `{ page, offset, limit, total, hasNext }`
- Applies to listing endpoints: `/courses`, `/courses/published-videos`, `/courses/completed`, `/courses/saved-course`

---

## Versioning
- Assumption: v1 (unversioned paths). Introduce versioned prefixes (e.g., `/v1`) when future breaking changes are required.

---

## Security Considerations
- Authentication and RBAC are enforced per endpoint using server-side session and permission checks.
- Admin-only actions are strictly gated.
- Cloudinary operations:
  - Client uploads videos directly to Cloudinary using an unsigned upload preset and chunked upload (recommended 6MB chunks).
  - Use headers `X-Unique-Upload-Id` and `Content-Range` during chunked upload to `https://api.cloudinary.com/v1_1/<CLOUD_NAME>/video/upload` along with `upload_preset`.
  - Server receives only metadata (`cloudinaryUrl`, `cloudinaryId`, `thumbnailUrl`, `durationSeconds`).
  - Deletion uses server-side credentials to call Cloudinary `uploader.destroy` with appropriate `resource_type`.

Client chunked upload (example):

```javascript
const CLOUD_NAME = "drqacxq8d";              // deployment-specific
const UPLOAD_PRESET = "course-videos";       // unsigned preset for course videos
const CHUNK_SIZE = 6 * 1024 * 1024;          // 6 MB

async function uploadLargeVideo(file, onProgress) {
  const uploadId = crypto.randomUUID();
  const totalSize = file.size;
  let start = 0, chunkIndex = 0;

  while (start < totalSize) {
    const end = Math.min(start + CHUNK_SIZE, totalSize);
    const chunk = file.slice(start, end);
    const formData = new FormData();
    formData.append("file", chunk);
    formData.append("upload_preset", UPLOAD_PRESET);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`, {
      method: "POST",
      headers: {
        "X-Unique-Upload-Id": uploadId,
        "Content-Range": `bytes ${start}-${end - 1}/${totalSize}`,
      },
      body: formData,
    });
    if (!res.ok) throw new Error(await res.text());
    await res.json(); // result per chunk
    start = end;
    chunkIndex++;
    onProgress?.(Math.round((start / totalSize) * 100));
  }
}
```

Note: Cloudinary returns errors like `{"error":{"message":"Unknown API key"}}` when misconfigured or using the wrong auth mode. The unsigned upload preset flow does not require an API key on the client; configure presets in Cloudinary console.

---

## Example Workflows

### Workflow 1: Create and Publish a Course
1. Client uploads video to Cloudinary in chunks; capture `cloudinaryUrl`, `cloudinaryId`, `thumbnailUrl`, `durationSeconds`.
2. POST `/courses/videos-upload` with metadata to validate and propagate.
3. POST `/courses` with title/description/tags/visibility and optional thumbnail (file or URL).
4. POST `/courses/:courseId/chapters` to add a chapter.
5. POST `/courses/:courseId/chapters/:chapterIndex/lessons` to add the first lesson with the video metadata.
6. POST `/courses/:courseId/chapters/:chapterIndex/quizzes` to add a quiz.
7. PUT `/admin/change-status-course/:id` with `status="published"` (admin only).
8. GET `/courses/published-videos` to verify listing and progress summary.

### Workflow 2: Save Course and Track Progress
1. POST `/courses/:id/save` with `{ "save": true }` to bookmark.
2. PUT `/courses/:courseId/chapters/:chapterId/lessons/progress` with `{ "watchedSeconds": 120 }`.
3. GET `/courses/:id/progress` to view detailed progress (lessons, quizzes, completion percent).
4. GET `/courses/saved-course` to confirm the course appears in saved list with updated `progressSummary`.

---

## Error Payload Examples

```json
{ "success": false, "message": "Unauthorized" }
```

```json
{ "success": false, "message": "Forbidden: insufficient permissions" }
```

```json
{ "success": false, "message": "Invalid tag filter: unknown tags" }
```

```json
{ "success": false, "message": "Failed to delete course from database." }
```

---
## Here is the sample JSON Structure when Course is being created using required API. 

``` sample json
{
    "success": true,
    "message": "Course fetched",
    "data": {
        "_id": "6985a43b8d5fafd7105be6ba",
        "title": "This is a temporary course",
        "description": "This is a temporary description",
        "tags": [
            "dietetics",
            "physiotherapy"
        ],
        "status": "published",
        "rejectReason": "",
        "accessLevel": "free",
        "visibility": "all",
        "user": "6937c1b95bba673ea5f36c10",
        "createdBy": {
            "_id": "6937c1b95bba673ea5f36c10",
            "name": "Support Admins",
            "email": "support@beyondlimitstherapy.com.au"
        },
        "thumbnailUrl": "https://res.cloudinary.com/drqacxq8d/image/upload/v1770366011/course_thumbnails/fjkkcnqz1ue4dr16gfzg.png",
        "thumbnailCloudinaryId": "course_thumbnails/fjkkcnqz1ue4dr16gfzg",
        "chapters": [
            {
                "title": "Chapter 01",
                "lessons": [
                    {
                        "title": "Lesson One",
                        "description": "Temporary Description Of Lessons.",
                        "videos": [
                            {
                                "cloudinaryUrl": "https://res.cloudinary.com/drqacxq8d/video/upload/v1770365516/f91cmemta3upv0mmfobo.mp4",
                                "cloudinaryId": "f91cmemta3upv0mmfobo",
                                "durationSeconds": 33.226522,
                                "thumbnailUrl": "https://res.cloudinary.com/drqacxq8d/video/upload/v1770365516/f91cmemta3upv0mmfobo.jpg"
                            }
                        ]
                    }
                ],
                "quizzes": [
                    {
                        "title": "Sample Quize",
                        "questions": [
                            {
                                "type": "single",
                                "prompt": "Sample Question One",
                                "options": [
                                    {
                                        "text": "Sample Option One"
                                    },
                                    {
                                        "text": "Sample Option Two"
                                    },
                                    {
                                        "text": "Sample Option Three"
                                    },
                                    {
                                        "text": "Sample Qption Four"
                                    }
                                ],
                                "correctOptionIndexes": [
                                    0
                                ]
                            },
                            {
                                "type": "multiple",
                                "prompt": "Sample Question Two",
                                "options": [
                                    {
                                        "text": "Sample Option One"
                                    },
                                    {
                                        "text": "Sample Option Two"
                                    },
                                    {
                                        "text": "Sample Option Three"
                                    },
                                    {
                                        "text": "Sample Option Four"
                                    }
                                ],
                                "correctOptionIndexes": [
                                    0,
                                    2
                                ]
                            }
                        ]
                    }
                ],
                "_id": "6985a43f8d5fafd7105be6bf"
            },
            {
                "title": "Chapter 02",
                "lessons": [
                    {
                        "title": "Temporary Lesson Two",
                        "description": "Temporary Description",
                        "videos": [
                            {
                                "cloudinaryUrl": "https://res.cloudinary.com/drqacxq8d/video/upload/v1770365825/adqhnrpldhgny4yi4l39.mp4",
                                "cloudinaryId": "adqhnrpldhgny4yi4l39",
                                "durationSeconds": 7.391022,
                                "thumbnailUrl": "https://res.cloudinary.com/drqacxq8d/video/upload/v1770365825/adqhnrpldhgny4yi4l39.jpg"
                            }
                        ]
                    }
                ],
                "quizzes": [],
                "_id": "6985a4438d5fafd7105be6c9"
            },
            {
                "title": "Chapter 03",
                "lessons": [],
                "quizzes": [
                    {
                        "title": "Sample Quiz",
                        "questions": [
                            {
                                "type": "multiple",
                                "prompt": "Sample Quize Question",
                                "options": [
                                    {
                                        "text": "Sample Option A"
                                    },
                                    {
                                        "text": "Sample Option B"
                                    },
                                    {
                                        "text": "Sample Option C"
                                    },
                                    {
                                        "text": "Sample Option D"
                                    }
                                ],
                                "correctOptionIndexes": [
                                    0,
                                    1
                                ]
                            },
                            {
                                "type": "single",
                                "prompt": "Sample Question",
                                "options": [
                                    {
                                        "text": "Sample Option A"
                                    },
                                    {
                                        "text": "Sample Option B"
                                    },
                                    {
                                        "text": "Sample Option C"
                                    },
                                    {
                                        "text": "Sample Option D"
                                    }
                                ],
                                "correctOptionIndexes": [
                                    0
                                ]
                            }
                        ]
                    }
                ],
                "_id": "6985a4468d5fafd7105be6d2"
            }
        ],
        "resources": [
            {
                "name": "Screenshot_20260206-081732.png",
                "url": "https://res.cloudinary.com/drqacxq8d/image/upload/v1770366013/courses/6985a43b8d5fafd7105be6ba/resources/jappiaxinp93sbozosam.png",
                "cloudinaryId": "courses/6985a43b8d5fafd7105be6ba/resources/jappiaxinp93sbozosam",
                "mimeType": "image/png",
                "sizeBytes": 120963
            }
        ],
        "totalDurationSeconds": 100.61754400000001,
        "totalQuizzes": 2,
        "totalChapters": 3,
        "createdAt": "2026-02-06T08:20:11.898Z",
        "updatedAt": "2026-02-06T08:20:23.732Z",
        "__v": 8
    }
}
```
