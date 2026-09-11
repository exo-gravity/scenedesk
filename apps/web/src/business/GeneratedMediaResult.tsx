import { GeneratedImageResult } from "./GeneratedImageResult";
import { GeneratedAudioResult } from "./GeneratedAudioResult";
import { GeneratedVideoResult } from "./GeneratedVideoResult";
export type GeneratedMediaResultProps = {
  tenantId: string;
  projectId: string;
  jobId: string;
  mediaId: string;
};
export function GeneratedMediaResult({
  kind,
  ...props
}: GeneratedMediaResultProps & { kind: "image" | "video" | "audio" }) {
  return kind === "image" ? (
    <GeneratedImageResult {...props} />
  ) : kind === "audio" ? (
    <GeneratedAudioResult {...props} />
  ) : (
    <GeneratedVideoResult {...props} />
  );
}
