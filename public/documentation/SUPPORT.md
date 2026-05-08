# API Specification: Support & Ticketing Module (v1.0.0)

## 1. Overview
The Support Module provides a unified ticketing system for user assistance and technical troubleshooting. It integrates multi-channel communication including in-app notifications, email alerts, and Slack-driven administrative resolution workflows.

- **Domain Context**: Customer Support & Issue Tracking
- **Architectural Style**: RESTful API with Slack Webhook integration
- **Versioning**: URI Versioning (Standard `/api` prefix)
- **Base URL**: `https://api.beyondlimits.com/api`

---

## 2. RBAC & Governance Model
Access to ticketing operations is governed by the `ticket` permission set in Better Auth.

### Role Hierarchy & Permissions Matrix
| Role | Action | Permission Required | Scope |
| :--- | :--- | :--- | :--- |
| **Admin** | Create/View/Resolve | `ticket.create`, `ticket.resolve` | Global (All Tickets) |
| **Trainer** | Create/View | `ticket.create` | Own Tickets Only |
| **Trainee** | Create/View | `ticket.create` | Own Tickets Only |
| **User** | Create/View | `ticket.create` | Own Tickets Only |

### Enforcement Logic
1.  **Authentication**: Valid Better Auth session required for all endpoints except `slack-interact`.
2.  **Authorization**: Explicit check for `ticket: ["create"]` for submission and `ticket: ["resolve"]` for administrative actions.
3.  **Ownership Check**: For `get` and `list` operations, non-admins are filtered to `userId === session.user.id`.
4.  **Slack Verification**: The `slack-interact` endpoint processes signed payloads from Slack (transactional trust).

---

## 3. Endpoint Specifications

### 3.1 Create Support Ticket
`POST /support/tickets`

Submits a new support ticket with optional multi-media attachments (Images/Videos).

**Request Body (multipart/form-data)**:
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `subject` | String | Yes | Brief summary of the issue |
| `type` | String | Yes | Ticket category slug (e.g., `app-technical-support`) |
| `description`| String | Yes | Detailed explanation |
| `images` | File[] | No | Up to 10 images (Max 50MB total) |
| `videos` | File[] | No | Up to 3 videos (Max 50MB total) |

---

### 3.2 List Support Tickets
`GET /support/tickets`

Retrieves a paginated list of tickets. Admins see all; others see their own.

**Query Parameters**:
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `page` | Integer | 1 | Page number |
| `limit` | Integer | 10 | Items per page (Max 100) |
| `typeSlug` | String | null | Filter by category |
| `search` | String | null | Search subject/description/user email |

---

### 3.3 Resolve Ticket
`POST /support/tickets/:id/resolve`

Marks a ticket as resolved and notifies the user. Admin-only.

**Request Schema**:
```json
{
  "message": "Resolution details provided to the user"
}
```

---

## 4. Request/Response Examples

### Example: Create Ticket (Success)
**Response (201 Created)**:
```json
{
  "success": true,
  "message": "Ticket created",
  "data": {
    "_id": "65f1a2...",
    "subject": "App crashing on login",
    "currentStatus": "pending",
    "imageUrls": ["https://cloudinary..."],
    "user": {
      "_id": "u123",
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

---

## 5. Validation & Business Logic Flow

1.  **Identity Verification**: Authenticate assigner and verify `ticket.create` permission.
2.  **Type Validation**: Normalize `type` string to slug and verify against `TicketType` collection or hardcoded `SUPPORT_TYPE_SLUGS`.
3.  **Media Processing**:
    - Validate file sizes (<50MB).
    - Stream to Cloudinary (Folder: `support-tickets`).
    - Collect `secure_url` and `public_id` for persistence.
4.  **Slack Integration**:
    - If `type === "app-technical-support"`, generate Slack blocks.
    - Post to Slack via Webhook or `chat.postMessage`.
    - Persist `slackMessageTs` for future thread updates.
5.  **Alerting Side Effects**:
    - Send `sendSupportTicketAlertEmail` to technical staff.
    - Dispatch push notifications to all online Admins.

---

## 6. Error Handling Model

| Code | Status | Meaning |
| :--- | :--- | :--- |
| `INVALID_OBJECT_ID`| 400 | The provided ticket/type ID is malformed |
| `UNSUPPORTED_TYPE` | 400 | The ticket category slug is invalid |
| `FILE_TOO_LARGE` | 400 | Attachment exceeds 50MB limit |
| `NOT_FOUND` | 404 | Ticket does not exist |

---

## 7. Security & Performance
- **Rate Limiting**: `writeLimiter` applied to all POST/DELETE routes (30 req / 15 min).
- **Sanitization**: Strict `isValidObjectId` validation on all ID parameters.
- **Media Cleanup**: Cloudinary `public_id` stored to allow future asset deletion.
- **Data Retention**: Resolved tickets persist for 30 days before potential archival/deletion (configured via `expireAt`).

---

## 8. Pagination & Filtering
- Standardized `offset`-based pagination.
- Full-text search support across `subject`, `description`, `user.name`, and `user.email`.
- Case-insensitive regex matching for search queries.

---

## 9. Performance Considerations
- Cloudinary uploads are processed sequentially within the request; high-volume media submission may impact response time.
- Slack/Email notifications are wrapped in `try-catch` to prevent external service failures from rolling back ticket creation.

---

## 10. Observability
- All administrative resolutions track the `resolvedBy` user ID.
- Slack interaction payloads are logged for troubleshooting webhook deliveries.

---

## 11. Assumptions & Constraints
1.  **Slack Configuration**: System assumes `SLACK_BOT_TOKEN` and `SLACK_SUPPORT_CHANNEL_ID` are configured for technical support routing.
2.  **Media Lifecycle**: Users cannot currently delete attachments once the ticket is created.
3.  **Resolution Lock**: Once a ticket is `resolved`, it cannot be reverted to `pending` via API.
