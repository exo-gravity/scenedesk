import { Alert, Image, Stack, Table, Text } from "@mantine/core";
import { useRef } from "react";
import type { Schema } from "./api";
import classes from "./script-document.module.css";
export function DocumentBody({
  document,
  text,
  onTextSelection,
}: {
  document?: Schema<"ScriptDocument"> | undefined;
  text: string;
  onTextSelection?: ((quote: string) => void) | undefined;
}) {
  const paper = useRef<HTMLElement>(null);
  function captureSelection() {
    if (!onTextSelection) return;
    const selection = window.getSelection();
    onTextSelection(
      selection &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        selection.focusNode &&
        paper.current?.contains(selection.anchorNode) &&
        paper.current.contains(selection.focusNode)
        ? selection.toString()
        : "",
    );
  }
  return (
    <article
      ref={paper}
      className={classes.paper}
      aria-label="剧本阅读正文"
      onPointerUp={captureSelection}
      onKeyUp={captureSelection}
    >
      {document ? (
        document.blocks.map((block, index) => {
          if (block.kind === "heading")
            return (
              <Text
                component="h2"
                size={block.level === 1 ? "xl" : "lg"}
                fw={600}
                key={index}
              >
                {block.text}
              </Text>
            );
          if (block.kind === "table")
            return (
              <Table.ScrollContainer minWidth={400} key={index}>
                <Table withTableBorder withColumnBorders>
                  <Table.Tbody>
                    {block.rows?.map((row, i) => (
                      <Table.Tr key={i}>
                        {row.map((cell, j) => (
                          <Table.Td key={j}>{cell}</Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            );
          if (block.kind === "image")
            return (
              <figure key={index}>
                <Image
                  src={block.imageData}
                  alt={block.alt ?? "文档图片"}
                  fit="contain"
                  w="auto"
                  maw="100%"
                  mah={560}
                  loading="lazy"
                />
                <figcaption>{block.alt}</figcaption>
              </figure>
            );
          return <p key={index}>{block.text || "\u00a0"}</p>;
        })
      ) : (
        <div className={classes.plain}>{text}</div>
      )}
    </article>
  );
}
export function Warnings({
  document,
}: {
  document?: Schema<"ScriptDocument"> | undefined;
}) {
  return document?.warnings.length ? (
    <Alert title="导入显示说明">
      <Stack gap="xs">
        {document.warnings.map((warning, i) => (
          <Text size="sm" key={i}>
            {warning}
          </Text>
        ))}
      </Stack>
    </Alert>
  ) : null;
}
