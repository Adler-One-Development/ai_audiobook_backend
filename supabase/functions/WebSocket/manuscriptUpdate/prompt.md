# Manuscript Update WebSocket Service

## Purpose

Adds additional chapters to existing ElevenLabs audiobook projects by processing
manuscript files from Supabase storage.

## Input (via WebSocket JSON message)

```json
{
  "gallery_id": "uuid-of-gallery",
  "file_id": "uuid-from-uploadFileToGallery-response",
  "studio_id": "elevenlabs-project-id",
  "supabase_anon_key": "your-anon-key",
  "access_token": "user-jwt-token",
  "eleven_labs_api_key": "sk_xxx",
  "voice_id": "nPczCjzI2devNBz1zQrb"
}
```

## Workflow

1. **Upload File**: Call `/uploadFileToGallery` with `gallery_id` and `file` →
   get back `file.id`
2. **Send Request**: Connect to WebSocket and send JSON with both `gallery_id`
   AND `file_id`
3. **Processing**: Service finds specific file in gallery, downloads, extracts
   chapters, splits long chapters
4. **Add to ElevenLabs**: POST each chapter to
   `/v1/studio/projects/{studio_id}/chapters`
5. **Update Database**: Append new chapters to existing `studio.chapters` array

## ElevenLabs API Endpoint Used

- **Add Chapter**: `POST /v1/studio/projects/{project_id}/chapters`
  - Body: `{ "name": "Chapter Title", "from_content_json": [...blocks] }`
  - Response: `{ "chapter_id": "xyz..." }`

## Response

```json
{
  "status": "completed",
  "message": "Successfully added 5 new chapter(s)!",
  "data": {
    "studio_id": "project-id",
    "chapters_added": 5,
    "new_chapter_ids": ["ch1", "ch2", "ch3", "ch4", "ch5"],
    "total_chapters": 15
  }
}
```

## Differences from manuscriptProcessing

| Feature    | manuscriptProcessing  | manuscriptUpdate |
| ---------- | --------------------- | ---------------- |
| File Input | Supabase Storage URL  | Multipart upload |
| ElevenLabs | Creates new project   | Adds to existing |
| Database   | Creates studio record | Updates existing |
| project_id | Required              | Not required     |
| studio_id  | Generated             | Required         |

## Running Locally

```bash
cd supabase/functions/WebSocket/manuscriptUpdate
node index.js
```

Port: 8081 (different from manuscriptProcessing's 8080)
