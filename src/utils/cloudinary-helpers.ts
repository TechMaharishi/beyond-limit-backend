import cloudinary from "@/config/cloudinary";

/** Generates an HLS streaming URL for a Cloudinary video asset. */
export function buildHlsUrl(publicId: string): string {
  return cloudinary.url(publicId, {
    resource_type: "video",
    format: "m3u8",
    transformation: [{ streaming_profile: "auto" }],
  });
}

/**
 * Generates a thumbnail URL from a Cloudinary video asset.
 * Captures the frame at 1 second if the video is long enough, otherwise frame 0.
 */
export function buildAutoThumbnailUrl(publicId: string, durationSeconds: number): string {
  const offset = durationSeconds >= 1 ? 1 : 0;
  return cloudinary.url(publicId, {
    resource_type: "video",
    format: "jpg",
    transformation: [{ start_offset: offset }],
  });
}
