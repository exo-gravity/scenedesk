import {
  MediaGenerationWorkspace,
  type MediaGenerationProps,
} from "./MediaGenerationWorkspace";
export function ImageGenerationWorkspace(props: MediaGenerationProps) {
  return <MediaGenerationWorkspace {...props} kind="image" />;
}
