import { GeneratedTimedMediaResult } from "./GeneratedTimedMediaResult";
import type { GeneratedMediaResultProps } from "./GeneratedMediaResult";
export function GeneratedVideoResult(props: GeneratedMediaResultProps) {
  return <GeneratedTimedMediaResult {...props} kind="video" />;
}
