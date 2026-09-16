/** A textarea exposes LF-normalized UTF-16 offsets, while fixed excerpts use
 * Unicode code points in the unmodified saved script (including CRLF/CR). */
export function selectedTextareaRange(
  source: string,
  displayed: string,
  start: number,
  end: number,
) {
  if (displayed !== source.replace(/\r\n?/g, "\n"))
    throw new Error("原文显示已改变，请重新打开后选文。");
  const points = Array.from(source),
    boundaries = new Map<number, number>([[0, 0]]);
  let renderedOffset = 0;
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    renderedOffset += point.length;
    if (point === "\r" && points[index + 1] === "\n") index++;
    boundaries.set(renderedOffset, index + 1);
  }
  const a = boundaries.get(start),
    b = boundaries.get(end);
  if (a === undefined || b === undefined || b <= a)
    throw new Error("请选择完整的原文片段。");
  return {
    range: { startOffset: a, endOffset: b },
    quote: points.slice(a, b).join(""),
  };
}

/** Rich document selections can omit layout-only separators. Only a unique,
 * exact quote is safe to map; ambiguous or transformed text uses the canonical
 * selection dialog instead. Never guess which occurrence the reader meant. */
export function selectedDocumentQuote(source: string, quote: string) {
  const displayed = source.replace(/\r\n?/g, "\n"),
    selected = quote.replace(/\r\n?/g, "\n");
  if (!selected || !selected.trim() || Array.from(selected).length > 20000)
    return null;
  const start = displayed.indexOf(selected);
  if (start < 0 || displayed.indexOf(selected, start + 1) >= 0) return null;
  try {
    return selectedTextareaRange(
      source,
      displayed,
      start,
      start + selected.length,
    );
  } catch {
    return null;
  }
}

/** Some browsers do not move the caret in readonly textareas. Keep fixed text
 * readonly while supporting horizontal keyboard selection without splitting a
 * Unicode code point. Offsets here are the textarea's UTF-16 DOM offsets. */
export function moveReadonlySelection(
  text: string,
  start: number,
  end: number,
  direction: "forward" | "backward" | "none",
  key: "ArrowLeft" | "ArrowRight",
  extend: boolean,
) {
  const boundaries = [0];
  for (const point of text)
    boundaries.push(boundaries[boundaries.length - 1]! + point.length);
  const anchor = direction === "backward" ? end : start,
    focus = direction === "backward" ? start : end;
  const next = !extend && start !== end
    ? key === "ArrowLeft" ? start : end
    : key === "ArrowLeft"
      ? boundaries.reduce((previous, offset) => offset < focus ? offset : previous, 0)
      : boundaries.find((offset) => offset > focus) ?? text.length;
  return extend
    ? {
        start: Math.min(anchor, next),
        end: Math.max(anchor, next),
        direction: next < anchor ? "backward" as const : "forward" as const,
      }
    : { start: next, end: next, direction: "none" as const };
}
