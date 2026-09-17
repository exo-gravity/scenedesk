import { useEffect, useRef, type ReactNode } from "react";
import {
  Button,
  Group,
  Menu,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  User,
  Mountains,
  Cube,
  Palette,
  ImageSquare,
  FilmStrip,
  Waveform,
  UserSound,
  FileText,
  CaretDown,
  MagnifyingGlass,
  Check,
} from "@phosphor-icons/react";
import classes from "./asset-library.module.css";

/**
 * 顺序即分组，两组对应契约里的两个 kind 枚举：
 *   设定资产 { character, location, prop, voice, style }
 *   媒体素材 { image, video, audio, document }
 * 「声音设定」是资产类别，不是媒体格式，必须与角色／场景／道具／风格同组。
 * 组内顺序沿用改动前的相对次序，未逐一照搬枚举的书写顺序。
 */
export const libraryCategories = [
  { value: "character", label: "角色", Icon: User },
  { value: "location", label: "场景", Icon: Mountains },
  { value: "prop", label: "道具", Icon: Cube },
  { value: "style", label: "风格", Icon: Palette },
  { value: "voice", label: "声音设定", Icon: UserSound },
  { value: "image", label: "图片", Icon: ImageSquare },
  { value: "video", label: "视频", Icon: FilmStrip },
  { value: "audio", label: "音频", Icon: Waveform },
  { value: "document", label: "文本", Icon: FileText },
] as const;
export type LibraryCategory = (typeof libraryCategories)[number]["value"];
export type LibraryLocation = {
  tenantId: string;
  contextProjectId?: string | undefined;
  projectId?: string | undefined;
  category: LibraryCategory;
  q: string;
  search: string;
  setQ: (q: string) => void;
  href: (values?: {
    type?: string;
    scope?: "project" | "shared";
    asset?: string;
    revision?: string;
    media?: string;
  }) => string;
};
export function LibraryNavigation({
  library,
  action,
  filter,
  projectName,
}: {
  library: LibraryLocation;
  action: ReactNode;
  filter: ReactNode;
  projectName?: string | undefined;
}) {
  const selected = libraryCategories.find(
    (item) => item.value === library.category,
  )!;
  const categories = useRef<HTMLElement | null>(null);
  // 窄屏的分类行是横向滚动容器：选中的分类可能在视野外。
  // 只调整该容器自身的 scrollLeft，不触发页面滚动。
  useEffect(() => {
    const nav = categories.current,
      active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const left = active.offsetLeft,
      right = left + active.offsetWidth;
    if (left < nav.scrollLeft) nav.scrollLeft = Math.max(0, left - 8);
    else if (right > nav.scrollLeft + nav.clientWidth)
      nav.scrollLeft = right - nav.clientWidth + 8;
  }, [library.category]);
  return (
    <header className={classes.header}>
      <div className={classes.heading}>
        <div className={classes.identity}>
          <Text component="h1" className={classes.title}>
            资产库
          </Text>
          <Menu position="bottom-start">
            <Menu.Target>
              <Button
                variant="subtle"
                rightSection={<CaretDown size={14} />}
                aria-label="资产库范围"
              >
                {library.projectId ? "当前项目" : "工作室共享"}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {library.contextProjectId && (
                <Menu.Item
                  component="a"
                  href={library.href({ scope: "project" })}
                  rightSection={
                    library.projectId ? <Check size={15} /> : undefined
                  }
                >
                  当前项目
                </Menu.Item>
              )}
              <Menu.Item
                component="a"
                href={library.href({ scope: "shared" })}
                rightSection={
                  !library.projectId ? <Check size={15} /> : undefined
                }
              >
                工作室共享
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
        <Group gap="xs" className={classes.actions}>
          {action}
        </Group>
      </div>
      <Text size="sm" c="dimmed" className={classes.context}>
        {library.projectId
          ? (projectName ?? "当前项目的创作设定与媒体文件")
          : "在工作室的不同项目中复用"}
      </Text>
      <div className={classes.tools}>
        <nav
          ref={categories}
          className={classes.categories}
          aria-label="资产库分类"
        >
          {libraryCategories.map(({ value, label, Icon }) => (
            <UnstyledButton
              component="a"
              key={value}
              href={library.href({ type: value })}
              aria-current={library.category === value ? "page" : undefined}
              className={classes.category}
              data-divider={value === "image" || undefined}
            >
              <Icon size={18} />
              <span>{label}</span>
            </UnstyledButton>
          ))}
        </nav>
        <div className={classes.searchTools}>
          <TextInput
            aria-label="搜索资产库"
            placeholder={`搜索${selected.label}名称或标签`}
            leftSection={<MagnifyingGlass size={16} />}
            value={library.q}
            onChange={(e) => library.setQ(e.currentTarget.value)}
            className={classes.search}
          />
          {filter}
        </div>
      </div>
    </header>
  );
}
