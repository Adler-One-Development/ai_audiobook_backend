# Process Chapter Audio Generation

## Overview

This is a Node.js WebSocket service running on port 8083 (default). It
orchestrates the process of converting a chapter and then generating audio for
it.

## API Dependencies

- `/functions/v1/convertChapter`
- `/functions/v1/generateAudioForChapter`

## Setup

1. `npm install`
2. `npm start`

## WebSocket API

- **URL**: `ws://<host>:8083`
- **Payload**:
  ```json
  {
      "project_id": "...",
      "chapter_id": "...",
      "access_token": "...",
      "eleven_labs_api_key": "..."
  }
  ```

## Testing Locally

1. Edit `test-client.js` with valid `PROJECT_ID`, `CHAPTER_ID`, `ACCESS_TOKEN`,
   and `ELEVEN_LABS_API_KEY`.
2. Run the test client:
   ```bash
   node test-client.js
   ```
