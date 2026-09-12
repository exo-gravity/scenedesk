import {
  ActionIcon,
  Badge,
  Button,
  createTheme,
  Input,
  Modal,
  NumberInput,
  Select,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  rem,
} from "@mantine/core";
import type { CSSVariablesResolver } from "@mantine/core";
import { tokens, semanticVariables } from "./tokens";
import classes from "./theme.module.css";
import { palettes } from "./shared-language-study";

export const theme = createTheme({
  fontFamily: tokens.font.family,
  primaryColor: "studio",
  primaryShade: { light: 8, dark: 2 },
  autoContrast: true,
  focusRing: "auto",
  focusClassName: classes.focus!,
  respectReducedMotion: true,
  activeClassName: "",
  defaultRadius: "sm",
  colors: {
    studio: [
      "#F4F4F2",
      "#E9EBE6",
      "#DCE3D5",
      "#B6C0AE",
      "#A8AEA5",
      "#71796D",
      "#515A51",
      "#3D433B",
      "#303830",
      "#222820",
    ],
    dark: [
      "#EAEAEA",
      "#B8B8B8",
      "#9C9C9C",
      "#737373",
      "#414141",
      "#303030",
      "#242424",
      "#1B1B1B",
      "#141414",
      "#101010",
    ],
    apricot: [
      "#FFF5E7",
      "#FCE6CB",
      "#F7D5AC",
      "#F3C996",
      "#F0C08A",
      tokens.accent.solid,
      "#DCA263",
      "#B57B3F",
      "#80532A",
      "#352D23",
    ],
    success: [
      "#F0F8F3",
      "#DEEEE4",
      "#C9E3D4",
      "#B7D6C4",
      tokens.status.success,
      "#80AE94",
      "#58896D",
      "#3D6550",
      "#2B4336",
      "#202D26",
    ],
    danger: [
      "#FFF1F0",
      "#FCDCD8",
      "#F7C2BB",
      tokens.status.danger,
      "#DE8A81",
      "#CD6A60",
      "#AE4E45",
      "#843A34",
      "#582D29",
      "#342321",
    ],
  },
  fontSizes: {
    xs: rem(12),
    sm: rem(14),
    md: rem(16),
    lg: rem(18),
    xl: rem(22),
  },
  lineHeights: { xs: "1.5", sm: "1.55", md: "1.7", lg: "1.5", xl: "1.4" },
  fontWeights: { regular: "400", medium: "500", bold: "600" },
  spacing: Object.fromEntries(
    Object.entries(tokens.spacing).map(([key, value]) => [key, rem(value)]),
  ),
  radius: { xs: rem(4), sm: rem(6), md: rem(8), lg: rem(12), xl: rem(16) },
  shadows: {
    xs: tokens.shadow,
    sm: tokens.shadow,
    md: tokens.shadow,
    lg: tokens.shadow,
    xl: tokens.shadow,
  },
  headings: {
    fontFamily: tokens.font.family,
    fontWeight: "600",
    sizes: {
      h1: { fontSize: rem(22), lineHeight: "1.4" },
      h2: { fontSize: rem(16), lineHeight: "1.5" },
      h3: { fontSize: rem(14), lineHeight: "1.5" },
    },
  },
  components: {
    Button: Button.extend({
      defaultProps: { size: "sm", variant: "default" },
      classNames: { root: classes.button, label: classes.buttonLabel },
      vars: (_, props) => ({
        root: {
          "--button-height":
            props.size === "xs"
              ? "var(--ws-control-compact)"
              : props.size === "md"
                ? "var(--ws-control-form)"
                : "var(--ws-control-default)",
        },
      }),
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { size: "md", variant: "subtle", color: "studio" },
      classNames: { root: classes.actionIcon },
      vars: (_, props) => ({
        root: {
          "--ai-size":
            props.size === "sm" || props.size === "xs"
              ? "var(--ws-control-compact)"
              : "var(--ws-control-default)",
        },
      }),
    }),
    Input: Input.extend({ classNames: { input: classes.input } }),
    TextInput: TextInput.extend({ defaultProps: { size: "sm" } }),
    NumberInput: NumberInput.extend({ defaultProps: { size: "sm" } }),
    Select: Select.extend({
      defaultProps: {
        size: "sm",
        checkIconPosition: "right",
        allowDeselect: false,
      },
    }),
    Textarea: Textarea.extend({
      defaultProps: { size: "sm", autosize: true, minRows: 3 },
      classNames: { input: classes.textarea },
    }),
    Text: Text.extend({ defaultProps: { size: "sm" } }),
    Badge: Badge.extend({
      defaultProps: {
        size: "md",
        radius: "xs",
        variant: "outline",
        color: "studio",
      },
      classNames: { root: classes.badge },
    }),
    Tabs: Tabs.extend({
      classNames: { tab: classes.tab, list: classes.tabList },
    }),
    Modal: Modal.extend({
      defaultProps: {
        centered: true,
        padding: "xl",
        radius: "md",
        overlayProps: { backgroundOpacity: 0.65, blur: 0 },
        closeButtonProps: { "aria-label": "关闭弹窗" },
      },
      classNames: {
        content: classes.modal,
        header: classes.modalHeader,
        title: classes.modalTitle,
      },
    }),
    Tooltip: Tooltip.extend({
      defaultProps: { withArrow: false, openDelay: 400, color: "dark.5" },
    }),
  },
});

function scheme(tone: "light" | "dark") {
  const p = palettes[tone];
  return {
    "--ws-canvas": p.canvas,
    "--ws-canvas-dot": p.dot,
    "--ws-panel": p.shell,
    "--ws-raised": p.surface,
    "--ws-hover": p.soft,
    "--ws-text": p.text,
    "--ws-secondary": p.secondary,
    "--ws-muted": p.secondary,
    "--ws-border": p.line,
    "--ws-border-subtle": p.line,
    "--ws-field-border": p.field,
    "--ws-accent": p.action,
    "--ws-accent-hover": p.selection,
    "--ws-accent-soft": p.soft,
    "--ws-on-accent": p.onAction,
    "--ws-focus": p.focus,
    "--ws-shadow": p.shadow,
    "--ws-danger": tone === "light" ? "#9B332B" : tokens.status.danger,
    "--ws-success": tone === "light" ? "#326848" : tokens.status.success,
    "--ws-warning": tone === "light" ? "#845814" : tokens.status.warning,
    "--mantine-color-body": p.canvas,
    "--mantine-color-text": p.text,
    "--mantine-color-dimmed": p.secondary,
    "--mantine-color-default": p.surface,
    "--mantine-color-default-hover": p.soft,
    "--mantine-color-default-border": p.line,
    "--mantine-color-default-color": p.text,
    "--mantine-color-error":
      tone === "light" ? "#9B332B" : tokens.status.danger,
  };
}
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: { ...semanticVariables },
  light: scheme("light"),
  dark: scheme("dark"),
});
