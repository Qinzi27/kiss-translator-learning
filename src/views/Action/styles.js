/**
 * Material 3 styles for the content FAB and its action menu.
 * These rules depend on the CSS variables injected by M3Theme.
 */
export const ACTION_STYLES = String.raw`
.kt-content-fab.MuiFab-root {
  width: 56px;
  height: 56px;
  min-width: 56px;
  min-height: 56px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 16px;
  background-color: var(--kt-fab-fill, var(--kt-pric));
  box-shadow: var(--kt-shadow-2);
  color: var(--kt-fab-ink, var(--kt-onpric));
  cursor: pointer;
  transition: background-color .2s ease, box-shadow .2s ease, transform .2s var(--kt-spring);
}
@media (hover: hover) {
  .kt-content-fab.MuiFab-root:hover {
    background-color: var(--kt-fab-fill, var(--kt-pric));
    background-color: color-mix(in srgb, var(--kt-fab-ink, var(--kt-onpric)) 8%, var(--kt-fab-fill, var(--kt-pric)));
  }
}
.kt-content-fab.MuiFab-root.Mui-focusVisible,
.kt-content-fab.MuiFab-root[aria-expanded="true"],
.kt-content-fab.MuiFab-root:active {
  background-color: var(--kt-fab-fill, var(--kt-pric));
  background-color: color-mix(in srgb, var(--kt-fab-ink, var(--kt-onpric)) 10%, var(--kt-fab-fill, var(--kt-pric)));
}
.kt-content-fab.MuiFab-root:active { transform: scale(.96); }
.kt-content-fab.MuiFab-root.Mui-focusVisible { outline: none; box-shadow: var(--kt-shadow-2), inset 0 0 0 3px var(--kt-pri); }
.kt-content-fab .MuiSpeedDialIcon-root { width: 24px; height: 24px; display: grid; place-items: center; }
.kt-content-fab .MuiSpeedDialIcon-root svg { width: 24px; height: 24px; }
.kt-content-fab-menu { min-width: 210px; max-height: min(360px, calc(100vh - 24px)); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 5px; border: 1px solid var(--kt-linev); border-radius: 4px; background: var(--kt-sf0); }
.kt-content-fab-menu .MuiMenu-list { display: flex; flex-direction: column; gap: 4px; padding: 0; }
.kt-content-fab-menu__item { min-height: 44px; gap: 10px; padding: 0 14px; border-radius: 8px; color: var(--kt-on); font-size: 12.5px; font-weight: 650; white-space: nowrap; transition: background .15s ease, transform .15s ease; }
@media (hover: hover) {
  .kt-content-fab-menu__item:hover { background: var(--kt-sf1); }
}
.kt-content-fab-menu__item:active { transform: scale(.97); }
.kt-content-fab-menu__item .MuiListItemIcon-root { min-width: 24px; color: var(--kt-pri); }
.kt-content-fab-menu__item svg { width: 19px; height: 19px; }

.kt-content-fab-progress-ring { position: absolute; inset: 4px; border: 2px solid currentColor; border-left-color: transparent; border-right-color: transparent; border-radius: 50%; pointer-events: none; animation: kt-fab-progress-spin 1s linear infinite; }
.kt-content-fab-lock { position: absolute; top: -3px; right: -3px; display: grid; place-items: center; width: 21px; height: 21px; border: 2px solid var(--kt-fab-fill, var(--kt-pric)); border-radius: 50%; background: var(--kt-fab-ink, var(--kt-onpric)); color: var(--kt-fab-fill, var(--kt-pric)); pointer-events: none; }
.kt-content-fab-lock svg { width: 13px; height: 13px; }
.kt-content-fab[data-translation-state="error"] { outline: 3px solid currentColor; outline-offset: 2px; }
.kt-content-fab-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; pointer-events: none; }
@keyframes kt-fab-progress-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .kt-content-fab.MuiFab-root { transition: none; }
  .kt-content-fab-progress-ring { animation: none; border-style: dashed; }
}
`;
