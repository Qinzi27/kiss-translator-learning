import { emitInternalMessage, subscribeInternalMessage } from "./internalEvents";

test("ordinary DOM events and postMessage cannot reach the isolated internal bus", () => {
  const listener = jest.fn();
  const stop = subscribeInternalMessage(listener);
  document.dispatchEvent(new CustomEvent("kiss_translator_inner", {
    detail: { action: "open_tranbox", args: { text: "Synthetic sample" } },
  }));
  window.dispatchEvent(new MessageEvent("message", { data: { action: "open_tranbox" } }));
  expect(listener).not.toHaveBeenCalled();
  stop();
});

test("private delivery reaches only live subscribers and emits nothing to the page", () => {
  const pageListener = jest.fn();
  document.addEventListener("kiss_translator_inner", pageListener);
  const listener = jest.fn();
  const stop = subscribeInternalMessage(listener);
  const message = { action: "open_tranbox", args: { text: "Synthetic sample" } };
  emitInternalMessage(message);
  expect(listener).toHaveBeenCalledWith(message);
  expect(pageListener).not.toHaveBeenCalled();
  stop();
  emitInternalMessage(message);
  expect(listener).toHaveBeenCalledTimes(1);
  document.removeEventListener("kiss_translator_inner", pageListener);
});
