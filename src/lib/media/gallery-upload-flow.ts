interface UploadProcessingState {
  mediaId: string | null;
  targetAlbumId?: string;
  uploadFinalized: boolean;
}

export function getGalleryUploadMode(
  state: UploadProcessingState,
): "upload" | "associate-only" {
  if (state.targetAlbumId && state.mediaId && state.uploadFinalized) {
    return "associate-only";
  }
  return "upload";
}

export function getGalleryRetryProgress(uploadFinalized: boolean): number {
  return uploadFinalized ? 100 : 0;
}
