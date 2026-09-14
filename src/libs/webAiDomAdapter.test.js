import { webAiDomAdapter } from "./webAiDomAdapter";
import { execFileSync } from "child_process";
import path from "path";

const base = {
  providerId: "doubao",
  requestId: "one",
  instructionTag: "INSTRUCTION_ONE",
  begin: "BEGIN_ONE",
  end: "END_ONE",
  prompt: "INSTRUCTION_ONE\nBEGIN_ONE\n[translation]\nEND_ONE\nHello",
};
let originalLocation;
beforeEach(() => {
  originalLocation = window.location;
  delete window.location;
  window.location = new URL("https://www.doubao.com/chat/");
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ width: 10, height: 10 }]);
  document.body.innerHTML =
    '<textarea></textarea><button data-testid="chat_input_send_button">发送</button>';
  delete globalThis.__KISS_WEB_AI_BRIDGE_REQUEST__;
});
afterEach(() => {
  window.location = originalLocation;
  jest.restoreAllMocks();
});
const action = (name, extra = {}) =>
  webAiDomAdapter({ ...base, action: name, ...extra });

test("the serialized isolated-world function has no module closure dependency", () => {
  const isolated = new Function(`return (${webAiDomAdapter.toString()})`)();
  expect(isolated({ ...base, action: "probe" })).toEqual({ state: "ready" });
});

test("the production Babel + Terser output still works when only the function is serialized", () => {
  // Compile this one module with CRA's actual production rules/targets/minifier.
  // The Chrome override only changes entries/output/plugins; it leaves these
  // Babel and Terser settings untouched. No full application build is run.
  const script = `
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { createRequire } = require('module');
    const cra = createRequire(require.resolve('react-scripts/package.json'));
    const webpack = cra('webpack');
    const config = require('react-scripts/config/webpack.config')('production');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kiss-web-ai-production-'));
    config.entry = path.resolve('src/libs/webAiDomAdapter.js');
    config.output = { ...config.output, path: temporary, filename: 'adapter.cjs', library: { type: 'commonjs2' } };
    config.plugins = [];
    config.cache = false;
    config.devtool = false;
    config.performance = false;
    config.optimization.splitChunks = false;
    config.optimization.runtimeChunk = false;
    const compiler = webpack(config);
    compiler.run((error, stats) => {
      compiler.close(() => {
        try {
          if (error || stats.hasErrors()) throw error || new Error(stats.toString({ all: false, errors: true }));
          const fn = require(path.join(temporary, 'adapter.cjs')).webAiDomAdapter;
          process.stdout.write(JSON.stringify(fn.toString()));
        } catch (failure) { console.error(failure); process.exitCode = 1; }
        finally { fs.rmSync(temporary, { recursive: true, force: true }); }
      });
    });
  `;
  const serialized = JSON.parse(
    execFileSync(process.execPath, ["-e", script], {
      cwd: path.resolve(__dirname, "../.."),
      env: {
        ...process.env,
        NODE_ENV: "production",
        BABEL_ENV: "production",
        REACT_APP_CLIENT: "chrome",
      },
      encoding: "utf8",
      timeout: 25000,
    })
  );
  const isolated = new Function(`return (${serialized})`)();
  expect(isolated({ ...base, action: "probe" })).toEqual({ state: "ready" });
  expect(isolated({ ...base, action: "prepare" })).toEqual({
    state: "prepared",
  });
  expect(isolated({ ...base, action: "submit" })).toEqual({ state: "sent" });
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div data-role="assistant">BEGIN_ONE\n你好\nEND_ONE</div>'
  );
  expect(isolated({ ...base, action: "read" })).toEqual({
    state: "complete",
    translation: "你好",
  });
}, 30000);

test("never overwrites a draft restored by the website", () => {
  document.querySelector("textarea").value = "my unfinished message";
  expect(action("prepare")).toMatchObject({
    state: "error",
    code: "WEB_AI_DRAFT_PRESENT",
  });
  expect(document.querySelector("textarea").value).toBe(
    "my unfinished message"
  );
});

test("a repeated submit action cannot click send twice", () => {
  const click = jest.spyOn(document.querySelector("button"), "click");
  expect(action("prepare").state).toBe("prepared");
  expect(action("submit").state).toBe("sent");
  expect(action("submit").state).toBe("sent");
  expect(click).toHaveBeenCalledTimes(1);
});

test("a disabled Send waits for UI readiness and an expired injection never sends", () => {
  action("prepare");
  const button = document.querySelector("button");
  const click = jest.spyOn(button, "click");
  button.classList.add("disabled");
  expect(action("submit")).toEqual({ state: "not-ready" });
  button.classList.remove("disabled");
  expect(action("submit", { deadline: Date.now() - 1 })).toMatchObject({
    code: "WEB_AI_TIMEOUT",
  });
  expect(click).not.toHaveBeenCalled();
});

test("input echo and stale response cannot masquerade as current translation", () => {
  action("prepare");
  action("submit");
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div data-testid="message_text_content"></div><div data-role="assistant">BEGIN_OLD\n旧回答\nEND_OLD</div>'
  );
  document.querySelector('[data-testid="message_text_content"]').textContent =
    base.prompt;
  expect(action("read")).toEqual({ state: "waiting" });
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div data-role="assistant">BEGIN_ONE\n你好\nEND_ONE</div>'
  );
  expect(action("read")).toEqual({ state: "complete", translation: "你好" });
});

test("partial streaming response requires its closing marker and generation to stop", () => {
  action("prepare");
  action("submit");
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div data-role="assistant">BEGIN_ONE\n你好</div>'
  );
  expect(action("read").state).toBe("waiting");
  document.querySelector('[data-role="assistant"]').textContent += "\nEND_ONE";
  document.body.insertAdjacentHTML(
    "beforeend",
    '<button aria-label="停止生成"></button>'
  );
  expect(action("read").state).toBe("waiting");
  document.querySelector('[aria-label="停止生成"]').remove();
  expect(action("read")).toEqual({ state: "complete", translation: "你好" });
});

test("login and challenge are reported without filling or clicking", () => {
  const click = jest.spyOn(document.querySelector("button"), "click");
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div role="dialog">请登录后继续</div>'
  );
  expect(action("prepare")).toMatchObject({ code: "WEB_AI_LOGIN_REQUIRED" });
  document.querySelector('[role="dialog"]').textContent = "请完成安全验证";
  expect(action("prepare")).toMatchObject({
    code: "WEB_AI_VERIFICATION_REQUIRED",
  });
  expect(click).not.toHaveBeenCalled();
  expect(document.querySelector("textarea").value).toBe("");
});

test("navigation or missing task state cannot cause another send", () => {
  expect(action("submit")).toMatchObject({ code: "WEB_AI_REQUEST_LOST" });
  window.location = new URL("https://www.doubao.com.evil.test/");
  expect(action("prepare")).toMatchObject({ code: "WEB_AI_ORIGIN_CHANGED" });
});

test("Kimi reads only assistant messages and refuses marked user content", () => {
  window.location = new URL("https://www.kimi.com/");
  document.body.innerHTML =
    '<textarea></textarea><button class="send-button">发送</button>';
  action("prepare", { providerId: "kimi" });
  action("submit", { providerId: "kimi" });
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="segment-user"><div data-role="assistant">BEGIN_ONE\n错误用户文本\nEND_ONE</div></div><div class="segment-assistant">BEGIN_ONE\n你好\nEND_ONE</div>'
  );
  expect(action("read", { providerId: "kimi" })).toEqual({
    state: "complete",
    translation: "你好",
  });
});
