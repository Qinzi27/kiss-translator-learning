/** Experimental adapters for public chat UI only. This function must be fully
 * self-contained: scripting.executeScript serializes it into an isolated world.
 * It never reads cookies, account storage, or undocumented network endpoints.
 */
export function webAiDomAdapter(options) {
  const { action, requestId, providerId, prompt, begin, end, instructionTag } =
    options;
  const origins = {
    doubao: "https://www.doubao.com",
    kimi: "https://www.kimi.com",
  };
  const fail = (code, error) => ({ state: "error", code, error });
  if (options.deadline && Date.now() >= options.deadline) {
    return fail(
      "WEB_AI_TIMEOUT",
      "本次后台翻译已超时，已停止操作，避免迟到发送。"
    );
  }
  if (window.location.origin !== origins[providerId]) {
    return fail(
      "WEB_AI_ORIGIN_CHANGED",
      "AI 网页跳转到了未授权地址，已停止操作。"
    );
  }
  const key = "__KISS_WEB_AI_BRIDGE_REQUEST__";
  let state = globalThis[key];
  const visible = (node) => {
    if (
      !node ||
      !node.isConnected ||
      node.closest('[hidden],[aria-hidden="true"]')
    )
      return false;
    const style = getComputedStyle(node);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      node.getClientRects().length > 0
    );
  };
  const all = (selector) =>
    Array.from(document.querySelectorAll(selector)).filter(visible);
  const textOf = (node) => (node?.innerText || node?.textContent || "").trim();
  const editorSelector =
    'textarea,[contenteditable="true"][role="textbox"],[contenteditable="true"].ProseMirror,[contenteditable="true"][data-lexical-editor="true"]';
  const editorsNow = () =>
    all(editorSelector).filter(
      (node) =>
        !node.disabled &&
        !node.readOnly &&
        node.getAttribute("aria-disabled") !== "true" &&
        node.getAttribute("aria-readonly") !== "true"
    );
  // Do not guess a send button from a document-wide ancestor. An unsupported
  // composer must fail closed until its explicit input context is identified.
  const inputContext = (editor) =>
    editor.closest(
      'form,[role="form"],[data-testid="chat_input"],[data-testid="chat-input"],[data-testid="chat_input_container"],.chat-input,.chat-input-container,.chat-editor'
    );
  const editorText = (editor) =>
    editor.tagName === "TEXTAREA"
      ? editor.value
      : editor.innerText ?? editor.textContent ?? "";
  const ambiguousEditor = () =>
    fail("WEB_AI_EDITOR_AMBIGUOUS", "AI 网页有多个输入框，已停止操作，请手动检查后台标签。");
  const blocked = () => {
    const captcha = all(
      'iframe[src*="captcha"],iframe[src*="recaptcha"],[class*="captcha"][role="dialog"],[data-testid*="captcha"]'
    );
    if (captcha.length)
      return fail(
        "WEB_AI_VERIFICATION_REQUIRED",
        "AI 网页需要验证码或安全验证，请打开后台标签手动处理后重试。"
      );
    const dialogs = all(
      '[role="dialog"],[aria-modal="true"],[class*="login-modal"],[class*="login-panel"]'
    );
    if (
      dialogs.some((node) =>
        /验证码|安全验证|verify.{0,20}human/i.test(textOf(node))
      )
    ) {
      return fail(
        "WEB_AI_VERIFICATION_REQUIRED",
        "AI 网页需要验证，请打开后台标签手动处理后重试。"
      );
    }
    if (
      dialogs.some((node) =>
        /登录|登陆|扫码|sign\s?in|log\s?in/i.test(textOf(node))
      )
    ) {
      return fail(
        "WEB_AI_LOGIN_REQUIRED",
        "请打开后台标签，先登录所选 AI 网站，再重新翻译。"
      );
    }
    return null;
  };
  const restriction = blocked();
  if (restriction) return restriction;
  if (action === "probe") {
    const editors = editorsNow();
    if (editors.length > 1) return ambiguousEditor();
    const editor = editors[0];
    if (!editor) {
      const login = all('button,[role="button"]').some((node) =>
        /^(登录|登陆|登录体验|立即登录|Sign in|Log in)$/i.test(textOf(node))
      );
      return login
        ? fail(
            "WEB_AI_LOGIN_REQUIRED",
            "请打开后台标签登录所选 AI 网站后重试。"
          )
        : { state: "loading" };
    }
    return { state: "ready" };
  }
  if (action === "prepare") {
    if (state)
      return state.requestId === requestId
        ? { state: state.sent ? "sent" : "prepared" }
        : fail("WEB_AI_REQUEST_CONFLICT", "后台标签已有另一项翻译，请重试。");
    const editors = editorsNow();
    if (editors.length > 1) return ambiguousEditor();
    const editor = editors[0];
    if (!editor) return { state: "loading" };
    const context = inputContext(editor);
    if (!context || context === document.body || context === document.documentElement)
      return fail("WEB_AI_CONTEXT_UNKNOWN", "无法明确识别 AI 输入区域，已停止操作。");
    if (editorText(editor).trim()) {
      return fail(
        "WEB_AI_DRAFT_PRESENT",
        "AI 网页恢复了未发送草稿，已停止填入。请打开后台标签处理草稿后重试。"
      );
    }
    state = {
      requestId,
      begin,
      end,
      instructionTag,
      prompt,
      editor,
      context,
      sent: false,
    };
    globalThis[key] = state;
    editor.focus();
    if (editor.tagName === "TEXTAREA") {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      ).set.call(editor, prompt);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // Browser editing events support Lexical/ProseMirror without touching
      // their private framework state. A failed edit is never sent.
      const inserted = document.execCommand?.("insertText", false, prompt);
      if (!inserted) {
        editor.textContent = prompt;
        editor.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: prompt,
          })
        );
      }
    }
    return { state: "prepared" };
  }
  if (!state || state.requestId !== requestId) {
    return fail(
      "WEB_AI_REQUEST_LOST",
      "AI 网页已刷新或本次任务状态丢失，已停止，避免重复发送。"
    );
  }
  if (action === "submit") {
    if (state.sent) return { state: "sent" };
    const editors = editorsNow();
    if (
      editors.length !== 1 ||
      editors[0] !== state.editor ||
      !state.editor.isConnected ||
      !state.context?.isConnected ||
      inputContext(state.editor) !== state.context ||
      editorText(state.editor) !== state.prompt
    )
      return fail(
        "WEB_AI_EDITOR_CHANGED",
        "AI 输入框内容发生变化，已停止发送。"
      );
    const selectors =
      providerId === "doubao"
        ? '[data-testid="chat_input_send_button"],[data-testid="send_button"],[data-testid="send-button"]'
        : '.send-button,[data-testid="send-button"],[data-testid="send_button"]';
    const inContext = (selector) =>
      Array.from(state.context.querySelectorAll(selector)).filter(visible);
    const candidates = inContext(selectors).concat(
      inContext('button,[role="button"]').filter((node) =>
        /^(发送|发送消息|Send|Send message)$/i.test(
          node.getAttribute("aria-label") ||
            node.getAttribute("title") ||
            textOf(node)
        )
      )
    );
    const unique = candidates.filter(
      (node, index) => candidates.indexOf(node) === index
    );
    if (unique.length > 1)
      return fail("WEB_AI_SEND_AMBIGUOUS", "AI 输入区域有多个发送按钮，已停止发送。");
    const button = unique[0];
    if (!button) return { state: "not-ready" };
    if (
      inputContext(button) !== state.context ||
      (button.form && button.form !== state.editor.closest("form"))
    )
      return fail("WEB_AI_SEND_AMBIGUOUS", "发送按钮不属于当前输入区域，已停止发送。");
    if (
      button.disabled ||
      button.getAttribute("aria-disabled") === "true" ||
      button.classList.contains("disabled") ||
      getComputedStyle(button).pointerEvents === "none"
    ) return { state: "not-ready" };
    // Set before click: an exception or late response must never trigger a retry.
    state.sent = true;
    button.click();
    return { state: "sent" };
  }
  if (action === "read") {
    if (!state.sent) return fail("WEB_AI_NOT_SENT", "本次翻译尚未发送。");
    const selectors =
      providerId === "doubao"
        ? '[data-message-author-role="assistant"],[data-role="assistant"],[data-testid="receive_message"],[data-testid="message_text_content"],[class*="message-assistant"],.flow-markdown-body'
        : '[data-message-author-role="assistant"],[data-role="assistant"],.segment-assistant,.assistant-content';
    const responses = all(selectors).filter(
      (node) =>
        !node.closest(
          '[data-message-author-role="user"],[data-role="user"],.segment-user,[class*="message-user"]'
        )
    );
    // Avoid iterable/spread transforms: this function is serialized alone, so a
    // Babel runtime helper outside its body would be unavailable after injection.
    for (let index = responses.length - 1; index >= 0; index--) {
      const node = responses[index];
      const content = textOf(node);
      // Some sites share message wrappers between both roles. The input echo
      // contains this nonce instruction tag and can never count as a response.
      if (content.includes(state.instructionTag)) continue;
      const start = content.indexOf(state.begin);
      const finish = content.indexOf(state.end, start + state.begin.length);
      if (start < 0 || finish < 0) continue;
      const translation = content
        .slice(start + state.begin.length, finish)
        .trim();
      if (!translation || translation.length > 60000) continue;
      const busy = all('button,[role="button"]').some((button) =>
        /^(停止|停止生成|停止回答|Stop|Stop generating|Stop response)$/i.test(
          button.getAttribute("aria-label") ||
            button.getAttribute("title") ||
            textOf(button)
        )
      );
      return {
        state: busy ? "waiting" : "complete",
        translation: busy ? undefined : translation,
      };
    }
    return { state: "waiting" };
  }
  return fail("WEB_AI_UNKNOWN_ACTION", "不支持的后台网页操作。");
}
