jest.mock("./webAiBridge", () => ({ translateInWebAi: jest.fn() }));
jest.mock("./storage", () => ({ getSettingWithDefault: jest.fn() }));
jest.mock("./browser", () => ({
  browser: { runtime: { id: "extension-id" } },
}));
import { createWebAiMessageHandlers } from "./webAiMessages";

const sender = {
  id: "extension-id",
  tab: { id: 3, url: "https://example.com/article" },
  frameId: 0,
};
const args = {
  requestId: "request-12345",
  apiSlug: "saved-web",
  text: "Synthetic source",
  fromLang: "en",
  toLang: "zh-CN",
};
const stored = {
  transApis: [
    {
      apiSlug: "saved-web",
      learningAi: {
        providerId: "kimi",
        transport: "web",
        preferences: "saved preference",
      },
    },
  ],
};
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("provider and skill are read from saved config; no arbitrary URL/key forwarded", async () => {
  const translate = jest.fn().mockResolvedValue("译文");
  const h = createWebAiMessageHandlers({
    getSetting: async () => stored,
    translate,
  });
  expect(
    await h.translate(
      {
        ...args,
        providerId: "attacker",
        url: "https://invalid",
        key: "secret",
        preferences: "bad",
      },
      sender
    )
  ).toEqual({ trText: "译文" });
  const input = translate.mock.calls[0][0];
  expect(input.providerId).toBe("kimi");
  expect(input.preferences).toBe("saved preference");
  expect(input).not.toHaveProperty("key");
  expect(input).not.toHaveProperty("url");
});

test("rejects other senders, unsaved and disabled configs without opening tabs", async () => {
  const translate = jest.fn();
  const h = createWebAiMessageHandlers({
    getSetting: async () => stored,
    translate,
  });
  expect(
    (await h.translate(args, { ...sender, id: "other" })).error
  ).toBeTruthy();
  expect(
    (await h.translate({ ...args, apiSlug: "not-saved" }, sender)).error
  ).toContain("先");
  const disabled = createWebAiMessageHandlers({
    getSetting: async () => ({
      transApis: [{ ...stored.transApis[0], isDisabled: true }],
    }),
    translate,
  });
  expect((await disabled.translate(args, sender)).error).toBeTruthy();
  expect(translate).not.toHaveBeenCalled();
});

test("duplicate request cannot drop the original cancellation handle or cancel another tab", async () => {
  let signal;
  const translate = jest.fn(
    (_, options) =>
      new Promise((resolve, reject) => {
        signal = options.signal;
        signal.addEventListener("abort", () => reject(new Error("cancelled")));
      })
  );
  const h = createWebAiMessageHandlers({
    getSetting: async () => stored,
    translate,
  });
  const original = h.translate(args, sender);
  await settle();
  expect((await h.translate(args, sender)).error).toContain("重复");
  h.cancel(args, { ...sender, tab: { id: 4 } });
  expect(signal.aborted).toBe(false);
  h.cancel(args, sender);
  expect(signal.aborted).toBe(true);
  expect((await original).error).toBe("cancelled");
  expect(translate).toHaveBeenCalledTimes(1);
});

test("cancellation during storage read does not submit later", async () => {
  let read;
  const translate = jest.fn();
  const h = createWebAiMessageHandlers({
    getSetting: () =>
      new Promise((resolve) => {
        read = resolve;
      }),
    translate,
  });
  const pending = h.translate(args, sender);
  h.cancel(args, sender);
  read(stored);
  expect((await pending).error).toContain("取消");
  expect(translate).not.toHaveBeenCalled();
});
