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

export const theme = createTheme({
  fontFamily: tokens.font.family,
  primaryColor: "apricot",
  primaryShade: 5,
  autoContrast: true,
  focusRing: "auto",
  focusClassName: classes.focus!,
  respectReducedMotion: true,
  activeClassName: "",
  defaultRadius: "sm",
  colors: {
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
      defaultProps: { size: "md", variant: "subtle", color: "dark.1" },
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
        color: "dark.1",
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

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: { ...semanticVariables },
  light: {},
  dark: {
    "--mantine-color-body": tokens.surface.canvas,
    "--mantine-color-text": tokens.text.primary,
    "--mantine-color-dimmed": tokens.text.muted,
    "--mantine-color-default": tokens.surface.raised,
    "--mantine-color-default-hover": tokens.surface.hover,
    "--mantine-color-default-border": tokens.border.default,
    "--mantine-color-default-color": tokens.text.primary,
    "--mantine-color-error": tokens.status.danger,
  },
});
