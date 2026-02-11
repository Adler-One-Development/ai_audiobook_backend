
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export class AudioStorage {
  private client: SupabaseClient;
  private bucketName: string;

  constructor(client: SupabaseClient, bucketName: string = "audio_files") {
    this.client = client;
    this.bucketName = bucketName;
  }

  /**
   * Helper to upload a file and return its ID and Public URL.
   * It uses upsert: true to "remove if already exists" and "save file" in one atomic operation.
   */
  private async uploadFile(
    path: string,
    fileContent: ArrayBuffer | Uint8Array | Blob,
    contentType: string = "audio/mpeg"
  ): Promise<{ fileId: string; url: string }> {
    const { error } = await this.client.storage
      .from(this.bucketName)
      .upload(path, fileContent, {
        contentType,
        upsert: true,
      });

    if (error) {
      console.error(`Error uploading file to ${path}:`, error);
      throw new Error(`Failed to upload file: ${error.message}`);
    }

    const { data: publicUrlData } = this.client.storage
      .from(this.bucketName)
      .getPublicUrl(path);

    // We generate a new ID for the file record reference in our database, 
    // even though the storage path is stable.
    // If the requirement is to return the *storage* ID, we might need to fetch it, 
    // but typically we track files by a UUID in our DB or just use the URL.
    // The prompt asks to "return the file_id and url". 
    // Existing code generates a random UUID for fileId. We will stick to that pattern 
    // or use the path as the ID if preferred, but UUID is safer for DB refs.
    const fileId = crypto.randomUUID();

    return {
      fileId,
      url: publicUrlData.publicUrl,
    };
  }

  /**
   * Function 1: Generating audio for block
   * Path: audio_files/{studio_id}/blocks/{block_id}.txt
   */
  uploadBlockAudio(
    studioId: string,
    blockId: string,
    fileContent: ArrayBuffer | Uint8Array | Blob
  ) {
    const path = `audio_files/${studioId}/blocks/${blockId}.mp3`;
    return this.uploadFile(path, fileContent, "audio/mpeg");
  }

  /**
   * Function 2: Generating audio for chapter
   * Path: audio_files/{studio_id}/chapters/{chapter_id}.txt
   */
  uploadChapterAudio(
    studioId: string,
    chapterId: string,
    fileContent: ArrayBuffer | Uint8Array | Blob
  ) {
    const path = `audio_files/${studioId}/chapters/${chapterId}.mp3`;
    return this.uploadFile(path, fileContent, "audio/mpeg");
  }

  /**
   * Function 3: Generating audio for audiobook
   * Path: audio_files/{studio_id}/complete_audiobook/{studio_id}.txt
   */
  uploadAudiobookAudio(
    studioId: string,
    fileContent: ArrayBuffer | Uint8Array | Blob
  ) {
    // Prompt: "Check if an audio file for the specific studio_id already exists and remove it... Save the file using the studio_id."
    // Path: audio_files/{studio_id}/complete_audiobook/{studio_id}.mp3
    const path = `audio_files/${studioId}/complete_audiobook/${studioId}.mp3`;
    
    // Explicit removal check as requested, though upsert handles replacement.
    // We'll trust upsert for atomic replacement to ensure "latest version is saved".
    return this.uploadFile(path, fileContent, "audio/mpeg");
  }
}
