import { Modal } from "@mantine/core";
import classes from "./shell.module.css";

/** Only what the board actually does; a shortcut appears here the day it works. */
type Hint = { hint: string };
const groups: { title: string; items: [string, string | Hint][] }[] = [
  {
    title: "创作",
    items: [
      ["新建", { hint: "底部 ＋" }],
      ["复制", "⌘ D"],
      ["删除", "⌫"],
      ["重命名", { hint: "双击名称" }],
      ["编辑文字", { hint: "双击文字卡" }],
      ["全选", "⌘ A"],
      ["取消选择", "Esc"],
    ],
  },
  {
    title: "缩放",
    items: [
      ["放大", "⌘ +"],
      ["缩小", "⌘ −"],
      ["适应内容", "⌘ 0"],
      ["触控板", { hint: "双指捏合" }],
      ["鼠标", { hint: "⌘ + 滚轮" }],
    ],
  },
  {
    title: "移动画布",
    items: [
      ["键盘", { hint: "Space + 拖动" }],
      ["触控板", { hint: "双指滑动" }],
      ["鼠标", { hint: "中键或右键拖动" }],
      ["选择", "V"],
      ["抓手", "H"],
      ["框选", { hint: "拖动空白处" }],
      ["加选", { hint: "Shift + 点击" }],
    ],
  },
  {
    title: "其他",
    items: [
      ["撤销", "⌘ Z"],
      ["重做", "⌘ ⇧ Z"],
      ["快捷键", "?"],
    ],
  },
];

export function Shortcuts({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="快捷键"
      size="auto"
      radius="lg"
      padding="lg"
      overlayProps={{ backgroundOpacity: 0.08 }}
      classNames={{ title: classes.dialogTitle, content: classes.dialogContent, close: classes.dialogClose }}
    >
      <div className={classes.shortcuts}>
        {groups.map((group) => (
          <section key={group.title} className={classes.shortcutGroup}>
            <h3 className={classes.shortcutTitle}>{group.title}</h3>
            <dl className={classes.shortcutList}>
              {group.items.map(([action, keys]) => (
                <div key={action} className={classes.shortcut}>
                  <dt>{action}</dt>
                  <dd>
                    {typeof keys === "string" ? (
                      keys.split(" ").map((key, index) => (
                        <kbd key={index} className={classes.kbd}>
                          {key}
                        </kbd>
                      ))
                    ) : (
                      <span className={classes.hint}>{keys.hint}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
