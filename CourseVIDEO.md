You are an expert Node.js backend developer. I am build a Learning Management System (LMS) 
using Node.js, Express, and MongoDB (Mongoose). I need you to implement a full video captioning 
pipeline using Cloudinary's AI transcription add-on (powered by Google Cloud).

## Context
- Videos are already uploaded from the frontend directly to Cloudinary
- After upload, the frontend sends { url, public_id, metadata } to my backend
- Backend saves the video record to MongoDB
- I want to generate captions automatically using Cloudinary's transcription add-on
- No Redis or external queue services — MongoDB is the only data store

## What to implement

### 1. Mongoose Video Schema
Add these fields to the video schema:
- caption_status: enum ["pending", "processing", "completed", "failed"], default "pending"
- caption_url: String (nullable)
- caption_failure_reason: String (nullable)
- caption_retry_count: Number, default 0
- last_caption_attempt: Date (nullable)
- retryable: Boolean, default false

### 2. MongoDB Polling Worker
- Create a standalone polling module (not inside any route file)
- Use setInterval with a 60 second interval
- On each tick, use findOneAndUpdate atomically to find one video where 
  caption_status is "pending" and set it to "processing" in the same operation
  to prevent double processing
- Also on server startup, find any videos stuck in "processing" status where 
  last_caption_attempt is older than 10 minutes and reset them back to "pending"
- Call this polling module from the main Express app entry point (app.js or server.js)

### 3. Cloudinary Transcription Trigger
- After atomically claiming a video, call Cloudinary's transcription add-on API 
  using the video's public_id (no re-upload)
- Use Cloudinary's Node.js SDK
- Set last_caption_attempt to current timestamp before the API call
- If Cloudinary returns an error related to credit limits or quota, 
  set caption_status to "failed", retryable to true, and save the failure_reason
- If any other error occurs, also set to failed with retryable true

### 4. Cloudinary Webhook Handler
- Create a POST route at /api/webhooks/cloudinary/course
- Validate the incoming webhook signature using Cloudinary's SDK verification method
- On successful transcription notification: update the video by public_id, 
  set caption_url to the returned URL, set caption_status to "completed"
- On failed transcription notification: set caption_status to "failed", 
  retryable to true, save failure_reason

### 5. Manual Retry Endpoint
- Create a POST route at /api/videos/:id/retry-captions
- Validate that the video exists and caption_status is "failed"
- Reset caption_status to "pending" and retryable to false
- Do not call Cloudinary directly from this endpoint — let the poller handle it
- Return appropriate success/error responses

### 6. Video Save Endpoint
- On POST, accept { url, public_id, metadata } from the frontend
- Save the video with caption_status defaulting to "pending"
- Do not trigger Cloudinary transcription here — the poller handles it

## Code style and structure requirements
- Use async/await throughout, no callbacks
- Use try/catch for all error handling
- Separate files for: videoModel.js, captionWorker.js, cloudinaryWebhook.js, videoRoutes.js
- Add a comment above each major block explaining what it does
- Use environment variables for Cloudinary credentials (process.env.CLOUDINARY_API_KEY etc)
- Do not use any queue libraries (no BullMQ, no bee-queue, no Redis)

## Note
- Existing flow of video upload should not break.
- The frontend should not get effected like in datastructure of effect JSON.
- Frontend developer should not have to do any changes in frontend code. 