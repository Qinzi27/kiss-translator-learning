import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import LockOpenRoundedIcon from "@mui/icons-material/LockOpenRounded";
import { getFabAppearance } from "../../libs/fabAppearance";
import {
  IDLE_TRANSLATION_PROGRESS,
  isTranslationBusy,
  translationProgressLabel,
} from "../../libs/translationProgress";
import { supportsTouch } from "../../libs/touchCapability";
import TouchTranslateControl from "../../components/TouchTranslateControl";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import PaletteRoundedIcon from "@mui/icons-material/PaletteRounded";
import SelectAllRoundedIcon from "@mui/icons-material/SelectAllRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import TranslateIcon from "@mui/icons-material/Translate";
import TranslateRoundedIcon from "@mui/icons-material/TranslateRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import Fab from "@mui/material/Fab";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import SpeedDialIcon from "@mui/material/SpeedDialIcon";
import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import ThemeProvider from "../../hooks/M3Theme";
import Draggable from "./Draggable";
import { SettingProvider } from "../../hooks/Setting";
import {
  DEFAULT_FAB,
  MSG_OPEN_OPTIONS,
  MSG_OPEN_TRANBOX,
  MSG_POPUP_TOGGLE,
  MSG_TRANS_TOGGLE,
  MSG_TRANS_LOCK_SET,
  MSG_TRANS_TOGGLE_STYLE,
  MSG_TRANSBOX_TOGGLE,
} from "../../config";
import { useI18n } from "../../hooks/I18n";
import { isExt } from "../../libs/client";
import { sendBgMsg } from "../../libs/msg";
import { createMenuKeyDownHandler } from "../../libs/menuFocus";
import useWindowSize from "../../hooks/WindowSize";
import { useFullscreenDetect } from "../../hooks/useFullscreenDetect";
import { ACTION_STYLES } from "./styles";
import { subscribeInternalMessage } from "../../libs/internalEvents";
import { isTrustedUserEvent } from "../../libs/trustedInteraction";

const selectionUnavailable = () => false;
const emptySubscribe = () => () => {};
const idleProgress = () => IDLE_TRANSLATION_PROGRESS;
const emptyFabConfig = Object.freeze({});
const LONG_PRESS_MS = 650;
const LONG_PRESS_MOVE_PX = 8;

function subscribeSelectionEnabled(onChange) {
  const handleChange = (message) => {
    if (message?.action === MSG_TRANSBOX_TOGGLE) onChange();
  };
  return subscribeInternalMessage(handleChange);
}

// Flip and shift the menu near viewport edges. The FAB can reach any corner,
// so fallback placements cover all sides to prevent clipping.
export const FAB_POPPER_MODIFIERS = [
  {
    name: "flip",
    enabled: true,
    options: {
      fallbackPlacements: [
        "top-start",
        "bottom-end",
        "bottom-start",
        "right",
        "left",
      ],
    },
  },
  {
    name: "preventOverflow",
    enabled: true,
    options: { padding: 12 },
  },
  { name: "offset", options: { offset: [0, 10] } },
];

/**
 * Floating translation action button for content pages.
 * Supports dragging, edge snapping, and a Material 3 action menu.
 */
export function ContentFabContent({
  fabConfig = emptyFabConfig,
  configStore,
  translationProgress,
  processActions,
  getSelectionEnabled = selectionUnavailable,
  onStartupCommit,
}) {
  useLayoutEffect(() => {
    onStartupCommit?.();
  }, [onStartupCommit]);
  const i18n = useI18n();
  const initialConfig = useCallback(() => fabConfig, [fabConfig]);
  const config = useSyncExternalStore(
    configStore?.subscribe || emptySubscribe,
    configStore?.getSnapshot || initialConfig
  );
  const {
    x: fabX,
    y: fabY,
    edge: fabEdge,
    fabClickAction = DEFAULT_FAB.fabClickAction,
  } = config;
  const progress = useSyncExternalStore(
    translationProgress?.subscribe || emptySubscribe,
    translationProgress?.getSnapshot || idleProgress
  );
  const busy = isTranslationBusy(progress);
  const statusLabel = translationProgressLabel(progress);
  const appearance = getFabAppearance(config, progress.phase);
  const translationLocked = config.translationLocked === true;
  const lockLabel = translationLocked
    ? "持续翻译已锁定：新网页自动翻译"
    : "持续翻译未锁定：新网页不自动翻译";
  const lockError =
    typeof config.translationLockError === "string"
      ? config.translationLockError
      : "";
  // Use the current tab's runtime state, which can differ from stored settings.
  const selectionEnabled = useSyncExternalStore(
    subscribeSelectionEnabled,
    getSelectionEnabled
  );
  const fabWidth = 56; // Material 3 regular FAB size.
  const opensMenu = fabClickAction !== 1;
  const windowSize = useWindowSize();
  const [moved, setMoved] = useState(false); // Track whether a drag occurred.
  const [showFab, setShowFab] = useState(true);
  const [touchOpen, setTouchOpen] = useState(false);
  const [open, setOpen] = useState(false); // Action menu visibility.
  const anchorRef = useRef(null);
  const menuRef = useRef(null);
  const popperRef = useRef(null);
  const longPressRef = useRef(null);
  const suppressClickRef = useRef(false);
  const latestLockRef = useRef(translationLocked);
  latestLockRef.current = translationLocked;
  const handleMenuNavigation = useMemo(
    () => createMenuKeyDownHandler({ shadowOnly: true }),
    []
  );
  const { isVideoFullscreen } = useFullscreenDetect();

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  }, []);

  const toggleTranslationLock = useCallback(() => {
    processActions({
      action: MSG_TRANS_LOCK_SET,
      args: { enabled: !latestLockRef.current },
    });
  }, [processActions]);

  const handlePointerDown = useCallback(
    (event) => {
      cancelLongPress();
      if (
        !isTrustedUserEvent(event.nativeEvent || event) ||
        event.button !== 0 ||
        event.isPrimary === false
      ) {
        return;
      }
      suppressClickRef.current = false;
      const press = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      press.timer = setTimeout(() => {
        if (longPressRef.current !== press) return;
        longPressRef.current = null;
        suppressClickRef.current = true;
        setOpen(false);
        toggleTranslationLock();
      }, LONG_PRESS_MS);
      longPressRef.current = press;
    },
    [cancelLongPress, toggleTranslationLock]
  );

  useEffect(() => {
    const ownerDocument = anchorRef.current.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    const endPress = (event) => {
      if (event.pointerId === longPressRef.current?.pointerId)
        cancelLongPress();
    };
    const movePress = (event) => {
      const press = longPressRef.current;
      if (!press || event.pointerId !== press.pointerId) return;
      if (
        Math.hypot(event.clientX - press.x, event.clientY - press.y) >
        LONG_PRESS_MOVE_PX
      ) {
        cancelLongPress();
      }
    };
    const hidePress = () => {
      if (ownerDocument.hidden) cancelLongPress();
    };
    ownerDocument.addEventListener("pointermove", movePress, true);
    ownerDocument.addEventListener("pointerup", endPress, true);
    ownerDocument.addEventListener("pointercancel", endPress, true);
    ownerDocument.addEventListener("visibilitychange", hidePress);
    ownerWindow.addEventListener("blur", cancelLongPress);
    return () => {
      cancelLongPress();
      ownerDocument.removeEventListener("pointermove", movePress, true);
      ownerDocument.removeEventListener("pointerup", endPress, true);
      ownerDocument.removeEventListener("pointercancel", endPress, true);
      ownerDocument.removeEventListener("visibilitychange", hidePress);
      ownerWindow.removeEventListener("blur", cancelLongPress);
    };
  }, [cancelLongPress]);

  useEffect(() => {
    setShowFab(!isVideoFullscreen);
    // Close the menu when video fullscreen hides the FAB,
    // preventing an orphaned panel that cannot be reached or dismissed.
    if (isVideoFullscreen) {
      setOpen(false);
      cancelLongPress();
    }
  }, [cancelLongPress, isVideoFullscreen]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) anchorRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const ownerDocument = anchorRef.current.ownerDocument;
    let touchMoved = false;
    // Draggable surfaces stop bubbling events. Capture native events and use
    // their composed paths to identify the menu and FAB across shadow roots.
    const handleClickAway = (event) => {
      const path = event.composedPath();
      if (
        path.includes(menuRef.current) ||
        path.includes(anchorRef.current) ||
        path.some((node) => node.hasAttribute?.("data-kiss-touch-ui"))
      ) {
        return;
      }
      closeMenu();
    };
    const handleTouchStart = () => {
      touchMoved = false;
    };
    const handleTouchMove = () => {
      touchMoved = true;
    };
    const handleTouchEnd = (event) => {
      if (!touchMoved) handleClickAway(event);
      touchMoved = false;
    };

    ownerDocument.addEventListener("click", handleClickAway, true);
    ownerDocument.addEventListener("touchstart", handleTouchStart, true);
    ownerDocument.addEventListener("touchmove", handleTouchMove, true);
    ownerDocument.addEventListener("touchend", handleTouchEnd, true);
    return () => {
      ownerDocument.removeEventListener("click", handleClickAway, true);
      ownerDocument.removeEventListener("touchstart", handleTouchStart, true);
      ownerDocument.removeEventListener("touchmove", handleTouchMove, true);
      ownerDocument.removeEventListener("touchend", handleTouchEnd, true);
    };
  }, [closeMenu, open]);

  // Popper does not observe the anchor's edge-reveal transform animation.
  const updateMenuPosition = useCallback(() => {
    popperRef.current?.update();
  }, []);

  // Handle the start of a drag without changing ordinary click behavior.
  const handleStart = useCallback(() => {
    setMoved(false);
  }, []);

  // Close the menu before its transformed anchor moves away from it.
  const handleMove = useCallback(() => {
    cancelLongPress();
    setMoved(true);
    closeMenu(true);
  }, [cancelLongPress, closeMenu]);

  // Run an action and close the menu.
  const runAction = useCallback(
    (action) => {
      processActions({ action });
      closeMenu(true);
    },
    [closeMenu, processActions]
  );

  // Open the extension options page in a new browser tab.
  const openSettings = useCallback(() => {
    if (isExt) {
      sendBgMsg(MSG_OPEN_OPTIONS);
    } else {
      window.open(
        process.env.REACT_APP_OPTIONSPAGE,
        "_blank",
        "noopener,noreferrer"
      );
    }
    closeMenu(true);
  }, [closeMenu]);

  // Ignore clicks after dragging to prevent accidental activation.
  const handleClick = useCallback(
    (event) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (moved) {
        return;
      }
      // fabClickAction === 1 keeps the legacy direct translation action.
      if (!opensMenu) {
        runAction(MSG_TRANS_TOGGLE);
        return;
      }
      setOpen((current) => !current);
    },
    [moved, opensMenu, runAction]
  );

  const handleFabKeyDown = useCallback(
    (event) => {
      if (!isTrustedUserEvent(event.nativeEvent || event)) return;
      // A later keyboard activation is a new gesture, not the long-press click.
      if (event.key === "Enter" || event.key === " ") {
        suppressClickRef.current = false;
      }
      if (
        event.key === "ArrowDown" ||
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      ) {
        event.preventDefault();
        event.stopPropagation();
        cancelLongPress();
        setOpen(true);
      }
    },
    [cancelLongPress]
  );

  // Close the menu and return focus to the FAB before menu items unmount.
  const handleMenuKeyDown = useCallback(
    (event) => {
      if (event.key !== "Escape" && event.key !== "Tab") return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    },
    [closeMenu]
  );

  // Position the FAB at the viewport edge and vertical center on first load.
  const fabProps = useMemo(
    () => ({
      windowSize,
      width: fabWidth,
      height: fabWidth,
      left: fabX ?? -fabWidth,
      top: fabY ?? windowSize.h / 2,
      edge: fabEdge,
    }),
    [windowSize, fabWidth, fabX, fabY, fabEdge]
  );

  const items = [
    {
      label: i18n("popup_translate_page"),
      icon: TranslateRoundedIcon,
      action: () => runAction(MSG_TRANS_TOGGLE),
    },
    {
      label: i18n("text_style_alt"),
      icon: PaletteRoundedIcon,
      action: () => runAction(MSG_TRANS_TOGGLE_STYLE),
    },
    {
      label: i18n("selection_translate"),
      icon: SelectAllRoundedIcon,
      action: () => runAction(MSG_OPEN_TRANBOX),
      disabled: !selectionEnabled,
    },
    {
      label: i18n("open_menu"),
      icon: TuneRoundedIcon,
      action: () => runAction(MSG_POPUP_TOGGLE),
    },
    {
      label: i18n("open_setting"),
      icon: SettingsRoundedIcon,
      action: openSettings,
    },
    {
      label: i18n("touch_paragraph"),
      icon: TranslateRoundedIcon,
      action: () => setTouchOpen((value) => !value),
      hidden: !supportsTouch(),
    },
    {
      label: translationLocked
        ? "关闭持续翻译锁定"
        : "锁定持续翻译（新网页自动翻译）",
      icon: translationLocked ? LockOpenRoundedIcon : LockRoundedIcon,
      action: (event) => {
        if (!isTrustedUserEvent(event.nativeEvent || event)) return;
        toggleTranslationLock();
        closeMenu(true);
      },
    },
  ].filter((item) => !item.hidden);

  return (
    <Draggable
      key="fab"
      snapEdge // Keep the idle FAB partially hidden at the viewport edge.
      fitContent // The fixed menu must not be constrained by the 56px FAB wrapper.
      expanded={busy || open} // Keep the anchor fully revealed while the menu is open.
      {...fabProps}
      show={showFab}
      onStart={handleStart}
      onMove={handleMove}
      onPositionTransitionEnd={updateMenuPosition}
      handler={
        <Fab
          id="kt-content-fab-button"
          ref={anchorRef}
          className="kt-content-fab"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-controls={open ? "kt-content-fab-menu" : undefined}
          aria-label={`${i18n("translate")}，${lockLabel}`}
          aria-busy={busy}
          aria-describedby="kt-content-fab-progress"
          data-translation-state={progress.phase}
          data-translation-locked={translationLocked}
          title={`${statusLabel}。${opensMenu ? "点击打开翻译菜单" : progress.enabled ? "点击停止翻译" : "点击开始翻译"}。${lockLabel}；长按切换锁定，按向下箭头打开菜单${lockError ? `。${lockError}` : ""}`}
          style={{
            "--kt-fab-fill": appearance.backgroundColor,
            "--kt-fab-ink": appearance.color,
          }}
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onLostPointerCapture={cancelLongPress}
          onBlur={cancelLongPress}
          onKeyDown={handleFabKeyDown}
        >
          {busy && (
            <span className="kt-content-fab-progress-ring" aria-hidden="true" />
          )}
          {translationLocked && (
            <span className="kt-content-fab-lock" aria-hidden="true">
              <LockRoundedIcon />
            </span>
          )}
          {progress.phase === "error" ? (
            <ErrorOutlineRoundedIcon />
          ) : progress.phase === "done" && !(opensMenu && open) ? (
            <CheckRoundedIcon />
          ) : opensMenu ? (
            <SpeedDialIcon
              icon={<TranslateIcon />}
              openIcon={<CloseRoundedIcon />}
              open={open}
            />
          ) : (
            <TranslateIcon />
          )}
        </Fab>
      }
    >
      <span
        id="kt-content-fab-progress"
        className="kt-content-fab-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusLabel}。{lockLabel}
        {lockError ? `。${lockError}` : ""}
      </span>
      <Popper
        popperRef={popperRef}
        open={open && Boolean(anchorRef.current)}
        anchorEl={anchorRef.current}
        placement="top-end"
        // Render inside the content page's shadow root to retain M3Theme styles;
        // a portal to document.body would escape that root.
        disablePortal
        popperOptions={{ strategy: "fixed" }}
        modifiers={FAB_POPPER_MODIFIERS}
      >
        <Paper ref={menuRef} className="kt-content-fab-menu" elevation={6}>
          <MenuList
            id="kt-content-fab-menu"
            aria-labelledby="kt-content-fab-button"
            autoFocusItem
            onKeyDownCapture={handleMenuNavigation}
            onKeyDown={handleMenuKeyDown}
          >
            {items.map(({ label, icon: Icon, action, disabled }) => (
              <MenuItem
                className="kt-content-fab-menu__item"
                disabled={disabled}
                onClick={disabled ? undefined : action}
                key={label}
              >
                <ListItemIcon>
                  <Icon />
                </ListItemIcon>
                <ListItemText>{label}</ListItemText>
              </MenuItem>
            ))}
          </MenuList>
          {touchOpen && (
            <TouchTranslateControl processActions={processActions} />
          )}
        </Paper>
      </Popper>
    </Draggable>
  );
}

export default function ContentFab(props) {
  return (
    <SettingProvider context="fab">
      <ThemeProvider>
        <style>{ACTION_STYLES}</style>
        <ContentFabContent {...props} />
      </ThemeProvider>
    </SettingProvider>
  );
}
