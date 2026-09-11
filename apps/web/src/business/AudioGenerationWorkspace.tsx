import {
  MediaGenerationWorkspace,
  type MediaGenerationProps,
} from "./MediaGenerationWorkspace";
export function AudioGenerationWorkspace(props: MediaGenerationProps) {
  return <MediaGenerationWorkspace {...props} kind="audio" />;
}
