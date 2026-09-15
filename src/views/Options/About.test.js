import { act } from "react";
import { createRoot } from "react-dom/client";
import About from "./About";
import { useI18nMd } from "../../hooks/I18n";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("react-markdown", () => {
  const React = require("react");
  return ({ children }) => React.createElement("div", null, children);
});
jest.mock("../../hooks/I18n", () => ({
  useI18n: () => (key) => key,
  useI18nMd: jest.fn(() => ({ data: "Project details", loading: false })),
}));
jest.mock("../../components/Logo", () => {
  const React = require("react");
  return () => React.createElement("span", null, "Logo");
});

const envKeys = [
  "REACT_APP_LEARNING_EDITION",
  "REACT_APP_VERSION",
  "REACT_APP_VERSION_NAME",
  "REACT_APP_RELEASES_URL",
  "REACT_APP_HOMEPAGE",
  "REACT_APP_SITEURL",
];
const originalEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]])
);
const originalFetch = global.fetch;
let container;
let root;

beforeEach(() => {
  jest.clearAllMocks();
  useI18nMd.mockReturnValue({ data: "Project details", loading: false });
  process.env.REACT_APP_LEARNING_EDITION = "true";
  process.env.REACT_APP_VERSION = "2.0.35";
  process.env.REACT_APP_VERSION_NAME = "2.0.35-learning.6";
  process.env.REACT_APP_RELEASES_URL =
    "https://github.com/example/fork/releases";
  process.env.REACT_APP_HOMEPAGE = "https://github.com/example/fork";
  process.env.REACT_APP_SITEURL = "https://upstream.example";
  global.fetch = jest.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  global.fetch = originalFetch;
});

test("loads project details only after expansion", () => {
  act(() => root.render(<About />));
  expect(useI18nMd).not.toHaveBeenCalled();
  const summary = container.querySelector(".MuiAccordionSummary-root");

  act(() => summary.click());
  expect(useI18nMd).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Project details");

  act(() => summary.click());
  act(() => summary.click());
  expect(useI18nMd).toHaveBeenCalledTimes(1);
});

test("learning edition shows a local update workflow and fork download without checking online", () => {
  act(() => root.render(<About />));

  expect(container.querySelector(".kt-about-hero__version").textContent).toBe(
    "v2.0.35-learning.6"
  );
  const help = container.querySelector(
    '[aria-labelledby="kt-local-update-title"]'
  );
  expect(help.textContent).toContain("Python 3.9");
  expect(help.textContent).toContain("更新插件.command");
  expect(help.textContent).toContain("更新插件.bat");
  expect(help.textContent).toContain("重新加载");
  expect(help.textContent).toContain("原有设置会保留");
  expect(help.textContent).toContain("不能直接执行电脑上的脚本");
  const download = help.querySelector("a");
  expect(download.textContent).toBe("手动下载学习版安装包");
  expect(download.href).toBe(process.env.REACT_APP_RELEASES_URL);
  expect(download.target).toBe("_blank");
  expect(download.rel).toContain("noopener");
  expect(
    container.querySelector('a[href="https://upstream.example"]')
  ).toBeNull();
  expect(useI18nMd).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("one-click update button only reveals local instructions without navigation or requests", () => {
  act(() => root.render(<About />));
  const heading = container.querySelector("#kt-local-update-title");
  heading.scrollIntoView = jest.fn();
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === "使用一键更新"
  );
  const previousUrl = window.location.href;
  expect(button.hasAttribute("href")).toBe(false);

  act(() => button.click());

  expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  expect(document.activeElement).toBe(heading);
  expect(window.location.href).toBe(previousUrl);
  expect(useI18nMd).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("non-learning editions keep the upstream download link and base version fallback", () => {
  process.env.REACT_APP_LEARNING_EDITION = "false";
  delete process.env.REACT_APP_VERSION_NAME;
  act(() => root.render(<About />));

  expect(container.querySelector(".kt-about-update")).toBeNull();
  expect(container.querySelector(".kt-about-hero__version").textContent).toBe(
    "v2.0.35"
  );
  const check = Array.from(container.querySelectorAll("a")).find(
    (element) => element.textContent === "settings_check_updates"
  );
  expect(check.href).toBe(process.env.REACT_APP_RELEASES_URL);
  expect(
    container.querySelector('a[href="https://upstream.example"]')
  ).not.toBeNull();
});
