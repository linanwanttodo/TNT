import styled from "styled-components";
import { lightGray, vscBadgeBackground, vscForeground } from "../../..";
import { getFontSize } from "../../../../util";

// The composer card's border and fill live on GradientBorder, which wraps this
// element. Keeping them off here avoids drawing two nested outlines.
export const InputBoxDiv = styled.div<{}>`
  resize: none;
  font-family: inherit;
  border-radius: 0.5rem;
  padding: 0;
  margin: 0;
  height: auto;
  background-color: transparent;
  color: ${vscForeground};

  border: none;

  outline: none;
  font-size: ${getFontSize()}px;

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: ${lightGray}cc;
  }

  display: flex;
  flex-direction: column;
`;

export const HoverDiv = styled.div`
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  opacity: 0.5;
  background-color: ${vscBadgeBackground};
  color: ${vscForeground};
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const HoverTextDiv = styled.div`
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  color: ${vscForeground};
  display: flex;
  align-items: center;
  justify-content: center;
`;
