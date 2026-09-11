import { GeneratedImageResult } from "./GeneratedImageResult";
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
}: GeneratedMediaResultProps & { kind: "image" | "video" }) {
  return kind === "image" ? (
    <GeneratedImageResult {...props} />
  ) : (
    <GeneratedVideoResult {...props} />
  );
}
