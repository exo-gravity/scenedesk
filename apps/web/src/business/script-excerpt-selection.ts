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
