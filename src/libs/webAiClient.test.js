jest.mock("./client", () => ({ isExt: true }));
jest.mock("./msg", () => ({ sendBgMsg: jest.fn() }));
import { sendBgMsg } from "./msg";
import { MSG_WEB_AI_TRANSLATE, MSG_WEB_AI_CANCEL } from "../config/msg";
import { requestWebAiTranslation, cancelWebAiClientTasks } from "./webAiClient";
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
beforeAll(() => {
  let id = 0;
  Object.defineProperty(global, "crypto", {
    configurable: true,
    value: { randomUUID: () => `request-${++id}` },
  });
});
afterEach(async () => {
  cancelWebAiClientTasks();
  await settle();
  jest.clearAllMocks();
});

test("page queue submits one at a time, without retrying a failed website", async () => {
  let finish;
  sendBgMsg.mockImplementation((action) =>
    action === MSG_WEB_AI_CANCEL
      ? Promise.resolve({})
      : new Promise((resolve) => {
          finish = resolve;
        })
  );
  const first = requestWebAiTranslation({ text: "one" });
  const second = requestWebAiTranslation({ text: "two" }).catch((e) => e);
  const third = requestWebAiTranslation({ text: "three" }).catch((e) => e);
  expect(sendBgMsg).toHaveBeenCalledTimes(1);
  finish({ error: "Please login", code: "WEB_AI_LOGIN_REQUIRED" });
  await expect(first).rejects.toThrow("Please login");
  expect((await second).name).toBe("AbortError");
  expect((await third).name).toBe("AbortError");
  expect(sendBgMsg).toHaveBeenCalledTimes(1);
});

test("late cancelled provider A does not cancel fresh provider B", async () => {
  let oldFinish;
  sendBgMsg.mockImplementation((action, args) => {
    if (action === MSG_WEB_AI_CANCEL) return Promise.resolve({});
    if (args.text === "A")
      return new Promise((resolve) => {
        oldFinish = resolve;
      });
    return Promise.resolve({ trText: "B translation" });
  });
  const old = requestWebAiTranslation({ text: "A" }).catch((e) => e);
  cancelWebAiClientTasks();
  const next = requestWebAiTranslation({ text: "B" });
  expect((await old).name).toBe("AbortError");
  expect(await next).toBe("B translation");
  oldFinish({ trText: "stale A" });
  await settle();
  expect(
    sendBgMsg.mock.calls.filter(([a]) => a === MSG_WEB_AI_TRANSLATE)
  ).toHaveLength(2);
});
