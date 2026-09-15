// Browser-owned isTrusted cannot be set by page JavaScript. This check applies
// only to DOM input; extension messages and internal callbacks use their own
// authenticated channel and do not manufacture a DOM event.
export const isTrustedUserEvent = (event) => event?.isTrusted === true;

const INPUT_EVENTS = [
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "submit",
  "keydown",
  "keyup",
  "keypress",
  "input",
  "beforeinput",
  "change",
  "mousedown",
  "mouseup",
  "mousemove",
  "mouseover",
  "mouseout",
  "mouseenter",
  "mouseleave",
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointerover",
  "pointerout",
  "touchstart",
  "touchend",
  "touchmove",
  "paste",
  "drop",
  "dragstart",
];

// Install before React delegates events. The ShadowRoot also contains menus
// portalled within the injected UI, so they share the same boundary.
export function guardInjectedUi(root) {
  const guard = (event) => {
    if (isTrustedUserEvent(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const name of INPUT_EVENTS) root.addEventListener(name, guard, true);
  return () => {
    for (const name of INPUT_EVENTS)
      root.removeEventListener(name, guard, true);
  };
}
