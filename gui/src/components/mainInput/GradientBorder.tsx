import styled, { css } from "styled-components";

// Subtle neutral stroke at rest, a stronger one while the editor is focused.
const IDLE_STROKE = "var(--continue-input-border)";
const FOCUS_STROKE = "var(--continue-input-border-focus)";

export const GradientBorder = styled.div<{
  borderRadius?: string;
  borderColor?: string;
  loading: 0 | 1;
  /**
   * Set when an ancestor already draws the outline, which is the case inside
   * the composer shell. A border here would double the stroke and leave a
   * seam against the card edge.
   */
  nested?: boolean;
}>`
  ${(props) =>
    props.nested
      ? css`
          border: none;
          border-radius: 0;
        `
      : css`
          border: 1px solid ${props.borderColor || IDLE_STROKE};
          border-radius: ${props.borderRadius || "0"};

          transition: border-color 0.1s ease-in-out;

          &:focus-within {
            border-color: ${props.borderColor || FOCUS_STROKE};
          }
        `}
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
`;
