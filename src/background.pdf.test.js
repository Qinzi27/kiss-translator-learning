import fs from "fs";
import path from "path";
import vm from "vm";
import * as config from "./config";

// Run the actual command/menu registrations without starting unrelated
// background services, opening tabs, or calling the PDF/translation engines.
const source = fs.readFileSync(path.join(__dirname, "background.js"), "utf8");
const start = source.indexOf("async function toggleTranslation(tab)");
const commandCode = source.slice(
  start,
  source.indexOf("/**\n * 专门处理 SSE", start)
);

function harness() {
  const listeners = {};
  const tab = { id: 7, url: "https://papers.example/paper.pdf" };
  const browser = {
    tabs: { query: jest.fn().mockResolvedValue([tab]) },
    commands: {
      onCommand: {
        addListener: (listener) => {
          listeners.command = listener;
        },
      },
    },
    contextMenus: {
      onClicked: {
        addListener: (listener) => {
          listeners.menu = listener;
        },
      },
    },
  };
  const launchPdfInTab = jest.fn().mockResolvedValue(false);
  const sendTabMsg = jest.fn().mockResolvedValue(undefined);
  const kissLog = jest.fn();
  vm.runInNewContext(commandCode, {
    ...config,
    browser,
    launchPdfInTab,
    sendTabMsg,
    kissLog,
    openOptionsPage: jest.fn(),
    messageHandlers: {},
  });
  return { listeners, tab, browser, launchPdfInTab, sendTabMsg, kissLog };
}

test("Alt+Q obtains the current tab and takes over a PDF before sending ordinary page messages", async () => {
  const state = harness();
  state.launchPdfInTab.mockResolvedValue(true);
  await state.listeners.command(config.CMD_TOGGLE_TRANSLATE);
  expect(state.browser.tabs.query).toHaveBeenCalledWith({
    active: true,
    lastFocusedWindow: true,
  });
  expect(state.launchPdfInTab).toHaveBeenCalledWith(state.tab);
  expect(state.sendTabMsg).not.toHaveBeenCalled();
});

test("an ordinary page keeps the existing translation toggle message", async () => {
  const state = harness();
  state.tab.url = "https://papers.example/article";
  await state.listeners.command(config.CMD_TOGGLE_TRANSLATE);
  expect(state.launchPdfInTab).toHaveBeenCalledTimes(1);
  expect(state.sendTabMsg).toHaveBeenCalledWith(config.MSG_TRANS_TOGGLE);
});

test("the PDF context menu uses the clicked tab even if a different tab is currently active", async () => {
  const state = harness();
  const clicked = { id: 19, url: "file:///papers/selected.pdf" };
  state.launchPdfInTab.mockResolvedValue(true);
  await state.listeners.menu(
    { menuItemId: config.CMD_TOGGLE_TRANSLATE },
    clicked
  );
  expect(state.launchPdfInTab).toHaveBeenCalledWith(clicked);
  expect(state.browser.tabs.query).not.toHaveBeenCalled();
  expect(state.sendTabMsg).not.toHaveBeenCalled();
});

test("a non-PDF context-menu action retains the ordinary page toggle", async () => {
  const state = harness();
  await state.listeners.menu(
    { menuItemId: config.CMD_TOGGLE_TRANSLATE },
    { id: 19, url: "https://papers.example/article" }
  );
  expect(state.sendTabMsg).toHaveBeenCalledWith(config.MSG_TRANS_TOGGLE);
});

test("a failed PDF launch is logged once without also triggering page translation", async () => {
  const state = harness();
  const failure = new Error("tab closed during launch");
  state.launchPdfInTab.mockRejectedValue(failure);
  await state.listeners.command(config.CMD_TOGGLE_TRANSLATE);
  expect(state.kissLog).toHaveBeenCalledWith(
    "toggle translation or open PDF reader",
    failure
  );
  expect(state.sendTabMsg).not.toHaveBeenCalled();
});

test("a tab lookup failure is contained inside the command handler", async () => {
  const state = harness();
  state.browser.tabs.query.mockRejectedValue(new Error("window closed"));
  await state.listeners.command(config.CMD_TOGGLE_TRANSLATE);
  expect(state.kissLog).toHaveBeenCalledTimes(1);
  expect(state.launchPdfInTab).not.toHaveBeenCalled();
  expect(state.sendTabMsg).not.toHaveBeenCalled();
});

test("other shortcuts and selected-text menu actions do not launch a PDF reader", async () => {
  const state = harness();
  await state.listeners.command(config.CMD_TOGGLE_TRANSLATE_ONLY);
  await state.listeners.menu(
    { menuItemId: config.CMD_OPEN_TRANBOX, selectionText: "selected text" },
    state.tab
  );
  expect(state.launchPdfInTab).not.toHaveBeenCalled();
  expect(state.sendTabMsg.mock.calls).toEqual([
    [config.MSG_TRANS_TOGGLE_ONLY],
    [config.MSG_OPEN_TRANBOX, { text: "selected text" }],
  ]);
});
