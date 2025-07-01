import styled from "styled-components";

// Subtle neutral stroke at rest, a stronger one while the editor is focused.
const IDLE_STROKE =
  "color-mix(in srgb, var(--vscode-editor-foreground) 12%, transparent)";
const FOCUS_STROKE =
  "color-mix(in srgb, var(--vscode-editor-foreground) 20%, transparent)";

export const GradientBorder = styled.div<{
  borderRadius?: string;
  borderColor?: string;
  loading: 0 | 1;
}>`
  border: 1px solid ${(props) => props.borderColor || IDLE_STROKE};
  border-radius: ${(props) => props.borderRadius || "0"};
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  transition: border-color 0.1s ease-in-out;

  &:focus-within {
    border-color: ${(props) => props.borderColor || FOCUS_STROKE};
  }
`;
