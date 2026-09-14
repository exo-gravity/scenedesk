export type GenerationSubject =
  | { kind: "shot"; shotId: string; inputScope?: string }
  | { kind: "canvas"; canvasId: string; nodeId: string; sceneId: string };
/** Existing editing partitions remain unchanged; each inspected plan gets a distinct receipt owner. */
export function generationSessionPath(
  subject: GenerationSubject,
  inspectionPlanId?: string,
) {
  const editingPath =
    subject.kind === "shot"
      ? `shots/${subject.shotId}${subject.inputScope ?? ""}`
      : `canvases/${subject.canvasId}/nodes/${subject.nodeId}`;
  return inspectionPlanId
    ? `${editingPath}/attempts/${inspectionPlanId}`
    : editingPath;
}
