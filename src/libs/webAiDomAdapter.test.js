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
    '<form><textarea></textarea><button type="button" data-testid="chat_input_send_button">发送</button></form>';
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
    '<form><textarea></textarea><button type="button" class="send-button">发送</button></form>';
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

test.each(["detached", "hidden", "disabled", "readonly", "replaced with same prompt", "moved"])(
  "refuses submit when the prepared editor is %s",
  (change) => {
    action("prepare");
    const editor = document.querySelector("textarea");
    const click = jest.spyOn(document.querySelector("button"), "click");
    if (change === "detached") editor.remove();
    if (change === "hidden") editor.hidden = true;
    if (change === "disabled") editor.disabled = true;
    if (change === "readonly") editor.readOnly = true;
    if (change === "replaced with same prompt") {
      const replacement = editor.cloneNode();
      replacement.value = base.prompt;
      editor.replaceWith(replacement);
    }
    if (change === "moved") {
      document.body.insertAdjacentHTML("beforeend", "<form id='other'></form>");
      document.querySelector("#other").append(editor);
    }
    expect(action("submit")).toMatchObject({ code: "WEB_AI_EDITOR_CHANGED" });
    expect(click).not.toHaveBeenCalled();
  }
);

test.each([base.prompt + "\nMy private draft", " " + base.prompt, base.instructionTag])(
  "requires the entire prompt to match, not merely the instruction marker: %s",
  (draft) => {
    action("prepare");
    document.querySelector("textarea").value = draft;
    const click = jest.spyOn(document.querySelector("button"), "click");
    expect(action("submit")).toMatchObject({ code: "WEB_AI_EDITOR_CHANGED" });
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector("textarea").value).toBe(draft);
  }
);

test("does not fill or send when another visible editor contains a draft", () => {
  document.body.insertAdjacentHTML("beforeend", "<form><textarea>Other draft</textarea><button>Send</button></form>");
  const click = jest.spyOn(HTMLElement.prototype, "click");
  expect(action("probe")).toMatchObject({ code: "WEB_AI_EDITOR_AMBIGUOUS" });
  expect(action("prepare")).toMatchObject({ code: "WEB_AI_EDITOR_AMBIGUOUS" });
  expect(document.querySelector("textarea").value).toBe("");
  expect(click).not.toHaveBeenCalled();
});

test("a newly restored draft in a second editor prevents sending the first", () => {
  action("prepare");
  document.body.insertAdjacentHTML("beforeend", "<form><textarea>Restored draft</textarea><button>Send</button></form>");
  const click = jest.spyOn(HTMLElement.prototype, "click");
  expect(action("submit")).toMatchObject({ code: "WEB_AI_EDITOR_CHANGED" });
  expect(click).not.toHaveBeenCalled();
});

test("a rerender during input never causes a replacement editor to be sent", () => {
  document.querySelector("textarea").addEventListener("input", (event) => {
    const next = document.createElement("textarea");
    next.value = "Recovered private draft " + base.instructionTag;
    event.target.replaceWith(next);
  });
  action("prepare");
  const click = jest.spyOn(document.querySelector("button"), "click");
  expect(action("submit")).toMatchObject({ code: "WEB_AI_EDITOR_CHANGED" });
  expect(click).not.toHaveBeenCalled();
});

test("ignores document-wide send buttons belonging to a different context", () => {
  document.body.insertAdjacentHTML("afterbegin", '<button data-testid="send-button">Send</button>');
  const outside = jest.spyOn(document.body.firstElementChild, "click");
  const inside = jest.spyOn(document.querySelector("form button"), "click");
  action("prepare");
  expect(action("submit")).toEqual({ state: "sent" });
  expect(outside).not.toHaveBeenCalled();
  expect(inside).toHaveBeenCalledTimes(1);
});

test("does not fall back to an outside send button when the local button disappears", () => {
  action("prepare");
  document.querySelector("form button").remove();
  document.body.insertAdjacentHTML("beforeend", '<button data-testid="send-button">Send</button>');
  const click = jest.spyOn(document.querySelector("button"), "click");
  expect(action("submit")).toEqual({ state: "not-ready" });
  expect(click).not.toHaveBeenCalled();
});

test("refuses an ambiguous pair of local send buttons", () => {
  action("prepare");
  document.querySelector("form").insertAdjacentHTML("beforeend", '<button type="button" aria-label="Send">Send</button>');
  const click = jest.spyOn(HTMLElement.prototype, "click");
  expect(action("submit")).toMatchObject({ code: "WEB_AI_SEND_AMBIGUOUS" });
  expect(click).not.toHaveBeenCalled();
});

test("does not send a button explicitly associated with another form", () => {
  action("prepare");
  document.body.insertAdjacentHTML("beforeend", "<form id='other'></form>");
  const button = document.querySelector("button");
  button.setAttribute("form", "other");
  const click = jest.spyOn(button, "click");
  expect(action("submit")).toMatchObject({ code: "WEB_AI_SEND_AMBIGUOUS" });
  expect(click).not.toHaveBeenCalled();
});

test("unknown document-wide input context fails before filling", () => {
  document.body.innerHTML = '<textarea></textarea><button>Send</button>';
  expect(action("prepare")).toMatchObject({ code: "WEB_AI_CONTEXT_UNKNOWN" });
  expect(document.querySelector("textarea").value).toBe("");
});
