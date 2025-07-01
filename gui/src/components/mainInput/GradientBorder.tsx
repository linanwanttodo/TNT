import styled from "styled-components";

export const GradientBorder = styled.div<{
  borderRadius?: string;
  borderColor?: string;
  loading: 0 | 1;
}>`
  border-radius: ${(props) => props.borderRadius || "0"};
  padding: 1px;
  background: ${(props) =>
    props.borderColor || "var(--vscode-editorWidget-border)"};
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
`;
