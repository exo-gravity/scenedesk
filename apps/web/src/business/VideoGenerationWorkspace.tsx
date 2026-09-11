import {
  MediaGenerationWorkspace,
  type MediaGenerationProps,
} from "./MediaGenerationWorkspace";
export function VideoGenerationWorkspace(props: MediaGenerationProps) {
  return <MediaGenerationWorkspace {...props} kind="video" />;
}
