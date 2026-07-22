# Content Studio Frontend Design Compass

> 图片工作台工具编辑器、共享控件和 Modal 的具体结构与验收规则以
> [`2026-07-23-image-workbench-design-system-convergence.md`](../superpowers/specs/2026-07-23-image-workbench-design-system-convergence.md)
> 为准。本文件保留产品级视觉方向，不再为同一组件定义另一套尺寸。

## Direction

Content Studio is an enterprise AI image production workbench, not a marketing site. The first screen should feel like a serious creative operations surface: dense enough for repeated work, soft enough for long sessions, and tactile enough that canvas actions feel direct.

The current design direction is "precision glass workbench":

- Infinite canvas remains the primary surface.
- Nodes, toolbars, inspectors, and trays use translucent rounded glass.
- Functional controls are icon-first, with text only where scan speed matters.
- Selection, dragging, and generated state rely on light rings, lift, and subtle saturation.
- The interface avoids a single-hue theme by mixing blue action color, cyan system hints, green success, amber warnings, and restrained neutral glass.

## Tokens

- Background: deep neutral `#07090d` to `#0b0f16`, with subtle grid and angled light bands.
- Primary action: `#5d86f4`, hover `#769dff`.
- Info accent: `#75d0df`.
- Success: `#65d6a8`.
- Warning: `#f4bd72`.
- Danger: `#ff7c86`.
- Text primary: `#f7f8fb`.
- Text secondary: `#ccd3de`.
- Text tertiary: `#909aaa`.

## Radius

- Compact surfaces: 8px.
- Controls and icon buttons: 10px.
- Repeated sections and node cards: 12px.
- Independent modals: 16px; the docked editor keeps a square outer edge.
- Pills and state badges: 999px.

## Spacing

- Spacing scale: 4px, 8px, 12px, 16px, 24px, 32px, and 48px only.
- Shell rail padding: 8px to 16px.
- Floating toolbar offset: 24px from canvas edge.
- Panel safe area and section spacing: 24px.
- Node header height: 42px.
- Canvas node size: source/job 336 x 380, result 304 x 348.
- Node picker: 320px wide, searchable single-column menu, 48px minimum action height.

## Component Rules

- Tool palette keeps a compact vertical form on desktop and icon-only form below 1200px.
- Node picker appears at the drag release point and must remain large enough for fast selection.
- Node cards show strong selected rings and larger creation handles.
- Parameter panels dock to the right from top to bottom; the canvas resizes so controls and nodes remain unobscured.
- Inspector panels use the same glass material as tool panels, with larger image preview and rounded sections.
- Mobile switches to result preview cards and hides canvas-only editing controls.

## Figma Sync Note

Figma MCP is connected for the account `Haoye Wang`. The current toolset can write into an existing Figma design file and capture the local web app, but this session did not expose a create-new-design-file tool. To sync this redesign into Figma, provide a Figma design URL or file key, then capture `http://127.0.0.1:5174/` into that file and rebuild the editable frame from these tokens.
