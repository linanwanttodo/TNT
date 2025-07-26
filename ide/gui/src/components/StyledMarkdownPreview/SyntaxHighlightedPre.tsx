import { useContext } from "react";
import styled from "styled-components";
import { vscForeground } from "..";
import { VscThemeContext } from "../../context/VscTheme";

const generateThemeStyles = (theme: any) => {
  return Object.keys(theme)
    .map((key) => {
      return `
        & ${key} {
          color: ${theme[key]};
        }
      `;
    })
    .join("");
};

const StyledPre = styled.pre<{ theme: any }>`
  & .hljs {
    color: ${vscForeground};
  }

  margin-top: 0;
  margin-bottom: 0;

  ${(props) => generateThemeStyles(props.theme)}
`;

export const SyntaxHighlightedPre = (props: any) => {
  const currentTheme = useContext(VscThemeContext);
  return <StyledPre {...props} theme={currentTheme.theme} />;
};
