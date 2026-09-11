import { GeneratedTimedMediaResult } from "./GeneratedTimedMediaResult";
import type { GeneratedMediaResultProps } from "./GeneratedMediaResult";
export function GeneratedAudioResult(props: GeneratedMediaResultProps) {
  return <GeneratedTimedMediaResult {...props} kind="audio" />;
}
