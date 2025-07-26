import { act } from "@testing-library/react";
import { addAndSelectMockLlm } from "../../../util/test/config";
import { renderWithProviders } from "../../../util/test/render";
import {
  getElementByTestId,
  getElementByText,
  sendInputWithMockedResponse,
} from "../../../util/test/utils";
import { Chat } from "../Chat";

test("should render input box", async () => {
  await renderWithProviders(<Chat />);
  await getElementByTestId("continue-input-box-main-editor-input");
});

test("should be able to toggle modes", async () => {
  const { store } = await renderWithProviders(<Chat />);

  // Agent is the default mode
  expect(store.getState().session.mode).toBe("agent");

  // Simulate cmd+. keyboard shortcut to cycle through the mode list and back
  // to the default
  const expectedCycle = ["plan", "debug", "multitask", "chat", "agent"];
  for (const expectedMode of expectedCycle) {
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: ".",
          metaKey: true, // cmd key on Mac
        }),
      );
    });
    expect(store.getState().session.mode).toBe(expectedMode);
  }
});

test("should send a message and receive a response", async () => {
  const { ideMessenger, store } = await renderWithProviders(<Chat />);

  // First add and select the mock LLM
  await act(async () => {
    addAndSelectMockLlm(store, ideMessenger);
  });

  const CONTENT = "Expected response";
  const INPUT = "User input";

  await sendInputWithMockedResponse(ideMessenger, INPUT, [
    { role: "assistant", content: CONTENT },
  ]);

  await getElementByText(CONTENT);
});
