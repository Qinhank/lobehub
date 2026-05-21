import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  divider: css`
    height: 24px;
  `,

  // Inner container - dark mode
  innerContainerDark: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: linear-gradient(135deg, #0a0e1a 0%, #111827 50%, #0f172a 100%);
  `,

  // Inner container - light mode
  innerContainerLight: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #f1f5f9 100%);
  `,

  // Outer container
  outerContainer: css`
    position: relative;
  `,
}));
