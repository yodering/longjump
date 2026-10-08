# vnl-lj

Generated from the current project, including edits awaiting autosave. Return to the [theme index](../themes.md). Install the selected fonts and icons using the setup below; assets are acquired separately from their official sources.

## Font and icon setup

Follow [asset installation](../assets.md) when implementing this theme. Download and configure the selected free assets from their official sources; no font files or icon artwork are bundled. Weights below are the authored requests: load matching static faces or a variable range and report any unavailable weight. Register the exact family aliases below, or map the role tokens to the loader’s actual family.

| Selected font | Roles | Weights | Family stack | Setup |
| --- | --- | --- | --- | --- |
| <code>GT America</code> (paid) | brand, ui, editorial, data | 400, 500, 600 | <code>"GT America", sans-serif</code> | Use supplied licensed webfonts if available. Otherwise install the free fallback below and tell the user how to add [GT America](https://www.grillitype.com/shops/gt-america) later. |

### Free fallbacks for unavailable paid fonts

Install these only for the listed paid selections when licensed files are unavailable. Keep the paid family first, insert the installed free family before generic/system fallbacks, and preserve the authored weights. Leave other selected free families in place. Tell the user which fallback is active, link the vendor above, and explain where to add licensed webfont files and their font declarations to restore the selection.

| Paid selection | Roles | Free fallback | Weights | Fallback family stack | Setup |
| --- | --- | --- | --- | --- | --- |
| <code>GT America</code> | brand, ui, editorial, data | <code>Inter</code> | 400, 500, 600 | <code>"Sidebar Inter", sans-serif</code> | Download and load [Inter](https://rsms.me/inter/) in the app. |

### Icons

Selected: [Lucide](https://lucide.dev/guide/react/getting-started), outlined. Install and wire the selected free pack (React: <code>lucide-react</code>); reuse it if already installed. Use the official adapter for other frameworks.

Preserve icon size, color, weight, style, and accessible names. Match the selected style only where the pack supports it; Lucide’s official pack supplies outlines, so report a filled-style gap rather than claiming exact filled artwork. Keep existing package versions and add only missing packages using the receiving project’s package manager.

## Foundations

```json
{
  "name": "vnl-lj",
  "text": {
    "l": {
      "size": 24,
      "lineHeight": 32,
      "letterSpacing": -0.02
    },
    "m": {
      "size": 16,
      "lineHeight": 24,
      "letterSpacing": -0.01
    },
    "s": {
      "size": 14,
      "lineHeight": 20,
      "letterSpacing": -0.005
    },
    "xl": {
      "size": 36,
      "lineHeight": 40,
      "letterSpacing": -0.025
    },
    "xs": {
      "size": 12,
      "lineHeight": 16,
      "letterSpacing": 0
    },
    "xxl": {
      "size": 48,
      "lineHeight": 52,
      "letterSpacing": -0.035
    },
    "xxs": {
      "size": 10,
      "lineHeight": 14,
      "letterSpacing": 0
    }
  },
  "fonts": {
    "ui": {
      "family": "\"GT America\", sans-serif",
      "weights": {
        "heavy": 600,
        "medium": 500,
        "regular": 400
      }
    },
    "data": {
      "family": "\"GT America\", sans-serif",
      "weights": {
        "heavy": 600,
        "medium": 500,
        "regular": 400
      }
    },
    "brand": {
      "family": "\"GT America\", sans-serif",
      "weights": {
        "heavy": 600,
        "medium": 500,
        "regular": 400
      }
    },
    "editorial": {
      "family": "\"GT America\", sans-serif",
      "weights": {
        "heavy": 600,
        "medium": 500,
        "regular": 400
      }
    }
  },
  "border": {
    "l": 2,
    "m": 1,
    "s": 1,
    "none": 0
  },
  "radius": {
    "l": 20,
    "m": 12,
    "s": 8,
    "xl": 28,
    "xs": 4,
    "full": 9999,
    "zero": 0
  },
  "shadows": {
    "l": {
      "x": 0,
      "y": 12,
      "blur": 36,
      "color": {
        "dark": "neutral-1",
        "light": "neutral-10"
      },
      "spread": 0,
      "opacity": 14
    },
    "m": {
      "x": 0,
      "y": 4,
      "blur": 16,
      "color": {
        "dark": "neutral-1",
        "light": "neutral-10"
      },
      "spread": 0,
      "opacity": 10
    },
    "s": {
      "x": 0,
      "y": 1,
      "blur": 3,
      "color": {
        "dark": "neutral-1",
        "light": "neutral-10"
      },
      "spread": 0,
      "opacity": 12
    }
  },
  "spacing": {
    "l": 24,
    "m": 16,
    "s": 12,
    "xl": 32,
    "xs": 8,
    "xxl": 48,
    "xxs": 4,
    "zero": 0
  },
  "animation": {
    "large": {
      "easing": [
        0.22,
        1,
        0.36,
        1
      ],
      "duration": 300
    },
    "easing": [
      0.16,
      1,
      0.3,
      1
    ],
    "duration": 160,
    "popupScale": 0.98,
    "pressDistance": 1
  },
  "focusRing": {
    "color": "color-1",
    "width": "l",
    "opacity": 55
  },
  "iconStyle": "outlined",
  "iconFamily": "Lucide",
  "neutralTone": "neutral",
  "buttonRadius": "s",
  "colorEmphasis": 50,
  "surfaceDetails": {
    "dark": {
      "shade": 24,
      "highlight": 24,
      "gradientTop": 10,
      "recessedShade": 20,
      "gradientBottom": 12
    },
    "light": {
      "shade": 16,
      "highlight": 70,
      "gradientTop": 12,
      "recessedShade": 8,
      "gradientBottom": 5
    },
    "edgeColor": "neutral-6-transparent"
  },
  "primaryForeground": {
    "dark": "neutral-2",
    "light": "neutral-2"
  },
  "primaryActionColor": "neutral-10"
}
```

## light CSS variables

Define these in the app’s existing theme scope for this mode. Keep component styles linked to the variables.

| Variable | Value |
| --- | --- |
| `--theme-name` | vnl-lj |
| `--theme-icon-family` | Lucide |
| `--theme-icon-style` | outlined |
| `--toolbar-divider-bleed` | 0 |
| `--focus-ring-outline` | 2px solid color-mix(in srgb, #37373d 55%, transparent) |
| `--icon-stroke-width` | 2 |
| `--icon-light-display` | none |
| `--icon-regular-display` | inline |
| `--icon-bold-display` | none |
| `--motion-duration` | 160ms |
| `--motion-easing` | cubic-bezier(0.16, 1, 0.3, 1) |
| `--motion-type` | easing |
| `--motion-visual-duration` | 0.16 |
| `--motion-bounce` | 0.2 |
| `--motion-enabled` | 1 |
| `--motion-small-iterations` | infinite |
| `--motion-large-duration` | 300ms |
| `--motion-large-easing` | cubic-bezier(0.22, 1, 0.36, 1) |
| `--motion-large-type` | easing |
| `--motion-large-visual-duration` | 0.3 |
| `--motion-large-bounce` | 0.2 |
| `--motion-large-iterations` | infinite |
| `--motion-popup-scale` | 0.98 |
| `--motion-press-distance` | 1px |
| `--option-badge-background` | color-mix(in srgb, var(--color-1) 10%, transparent) |
| `--option-badge-foreground` | #37373d |
| `--navigation-active-foreground` | #202124 |
| `--emphasis-chart-fill` | #37373d33 |
| `--emphasis-balance-background` | #f2f2f3 |
| `--emphasis-rewards-background` | #f2f2f3 |
| `--emphasis-icon-background` | #f2f2f3 |
| `--emphasis-icon-foreground` | #202124 |
| `--emphasis-type-background` | #f2f2f3 |
| `--emphasis-type-foreground` | #202124 |
| `--navigation-active-background` | #37373d33 |
| `--surface-raised-image` | linear-gradient(180deg, #ffffff1f 0%, #ffffff00 48%, #2021240d 100%) |
| `--surface-raised-shadow` | inset 0px 1px 0px 0px #ffffffb3, inset 0px -1px 0px 0px #20212429 |
| `--surface-recessed-image` | linear-gradient(180deg, #2021240d 0%, #20212400 55%) |
| `--surface-recessed-shadow` | inset 0px 1px 2px 0px #20212414, inset 0px -1px 0px 0px #ffffff59 |
| `--space-zero` | 0px |
| `--space-xxs` | 4px |
| `--space-xs` | 8px |
| `--space-s` | 12px |
| `--space-m` | 16px |
| `--space-l` | 24px |
| `--space-xl` | 32px |
| `--space-xxl` | 48px |
| `--size-xxs` | 10px |
| `--line-xxs` | 14px |
| `--letter-spacing-xxs` | 0em |
| `--size-xs` | 12px |
| `--line-xs` | 16px |
| `--letter-spacing-xs` | 0em |
| `--size-s` | 14px |
| `--line-s` | 20px |
| `--letter-spacing-s` | -0.005em |
| `--size-m` | 16px |
| `--line-m` | 24px |
| `--letter-spacing-m` | -0.01em |
| `--size-l` | 24px |
| `--line-l` | 32px |
| `--letter-spacing-l` | -0.02em |
| `--size-xl` | 36px |
| `--line-xl` | 40px |
| `--letter-spacing-xl` | -0.025em |
| `--size-xxl` | 48px |
| `--line-xxl` | 52px |
| `--letter-spacing-xxl` | -0.035em |
| `--radius-zero` | 0px |
| `--radius-xs` | 4px |
| `--radius-s` | 8px |
| `--radius-m` | 12px |
| `--radius-l` | 20px |
| `--radius-xl` | 28px |
| `--radius-full` | 9999px |
| `--border-none` | 0px |
| `--border-s` | 1px |
| `--border-m` | 1px |
| `--border-l` | 2px |
| `--border-default-color` | #94949c33 |
| `--border-shadow-none` | 0 0 0 0 transparent |
| `--border-shadow-s` | 0 0 0 1px #94949c33 |
| `--border-shadow-m` | 0 0 0 1px #94949c33 |
| `--border-shadow-l` | 0 0 0 2px #94949c33 |
| `--font-ui` | "GT America", sans-serif |
| `--weight-ui-regular` | 400 |
| `--weight-ui-medium` | 500 |
| `--weight-ui-heavy` | 600 |
| `--font-brand` | "GT America", sans-serif |
| `--weight-brand-regular` | 400 |
| `--weight-brand-medium` | 500 |
| `--weight-brand-heavy` | 600 |
| `--font-editorial` | "GT America", sans-serif |
| `--weight-editorial-regular` | 400 |
| `--weight-editorial-medium` | 500 |
| `--weight-editorial-heavy` | 600 |
| `--font-data` | "GT America", sans-serif |
| `--weight-data-regular` | 400 |
| `--weight-data-medium` | 500 |
| `--weight-data-heavy` | 600 |
| `--color-none` | transparent |
| `--color-1` | #37373d |
| `--color-1-transparent` | #37373d33 |
| `--color-2` | #dfddd8 |
| `--color-2-transparent` | #dfddd833 |
| `--color-3` | #b5c5cd |
| `--color-3-transparent` | #b5c5cd33 |
| `--color-4` | #c7b3a1 |
| `--color-4-transparent` | #c7b3a133 |
| `--neutral-1` | #ffffff |
| `--neutral-1-transparent` | #ffffff33 |
| `--neutral-2` | #fafafa |
| `--neutral-2-transparent` | #fafafa33 |
| `--neutral-3` | #f2f2f3 |
| `--neutral-3-transparent` | #f2f2f333 |
| `--neutral-4` | #e4e4e7 |
| `--neutral-4-transparent` | #e4e4e733 |
| `--neutral-5` | #c5c5ca |
| `--neutral-5-transparent` | #c5c5ca33 |
| `--neutral-6` | #94949c |
| `--neutral-6-transparent` | #94949c33 |
| `--neutral-7` | #6e6e76 |
| `--neutral-7-transparent` | #6e6e7633 |
| `--neutral-8` | #505057 |
| `--neutral-8-transparent` | #50505733 |
| `--neutral-9` | #343438 |
| `--neutral-9-transparent` | #34343833 |
| `--neutral-10` | #202124 |
| `--neutral-10-transparent` | #20212433 |
| `--success` | #247348 |
| `--success-transparent` | #24734833 |
| `--warning` | #94651e |
| `--warning-transparent` | #94651e33 |
| `--error` | #bd3d42 |
| `--error-transparent` | #bd3d4233 |
| `--shadow-none` | none |
| `--shadow-s` | 0px 0.25px 0.75px 0px #2021240d, 0px 1px 3px 0px #20212413 |
| `--shadow-m` | 0px 1px 4px 0px #2021240b, 0px 4px 16px 0px #20212410 |
| `--shadow-l` | 0px 3px 9px 0px #2021240f, 0px 12px 36px 0px #20212416 |
| `--cte-canvas` | #ffffff |
| `--cte-surface` | #fafafa |
| `--cte-surface-muted` | #f2f2f3 |
| `--cte-text` | #202124 |
| `--cte-text-muted` | #6e6e76 |
| `--cte-border` | #94949c33 |
| `--cte-accent` | #37373d |
| `--cte-accent-text` | #fafafa |
| `--cte-danger` | #bd3d42 |
| `--cte-focus` | #37373d |
| `--cte-font` | "GT America", sans-serif |
| `--cte-font-size` | 14px |
| `--cte-font-weight` | 400 |
| `--cte-line-height` | 20px |
| `--cte-letter-spacing` | -0.005em |
| `--cte-detail-font-size` | 12px |
| `--cte-detail-line-height` | 16px |
| `--cte-detail-letter-spacing` | 0em |

## dark CSS variables

Define these in the app’s existing theme scope for this mode. Keep component styles linked to the variables.

| Variable | Value |
| --- | --- |
| `--theme-name` | vnl-lj |
| `--theme-icon-family` | Lucide |
| `--theme-icon-style` | outlined |
| `--toolbar-divider-bleed` | 0 |
| `--focus-ring-outline` | 2px solid color-mix(in srgb, #e2e2e8 55%, transparent) |
| `--icon-stroke-width` | 2 |
| `--icon-light-display` | none |
| `--icon-regular-display` | inline |
| `--icon-bold-display` | none |
| `--motion-duration` | 160ms |
| `--motion-easing` | cubic-bezier(0.16, 1, 0.3, 1) |
| `--motion-type` | easing |
| `--motion-visual-duration` | 0.16 |
| `--motion-bounce` | 0.2 |
| `--motion-enabled` | 1 |
| `--motion-small-iterations` | infinite |
| `--motion-large-duration` | 300ms |
| `--motion-large-easing` | cubic-bezier(0.22, 1, 0.36, 1) |
| `--motion-large-type` | easing |
| `--motion-large-visual-duration` | 0.3 |
| `--motion-large-bounce` | 0.2 |
| `--motion-large-iterations` | infinite |
| `--motion-popup-scale` | 0.98 |
| `--motion-press-distance` | 1px |
| `--option-badge-background` | color-mix(in srgb, var(--color-1) 10%, transparent) |
| `--option-badge-foreground` | #e2e2e8 |
| `--navigation-active-foreground` | #fafafa |
| `--emphasis-chart-fill` | #e2e2e833 |
| `--emphasis-balance-background` | #2a2a2e |
| `--emphasis-rewards-background` | #2a2a2e |
| `--emphasis-icon-background` | #2a2a2e |
| `--emphasis-icon-foreground` | #fafafa |
| `--emphasis-type-background` | #2a2a2e |
| `--emphasis-type-foreground` | #fafafa |
| `--navigation-active-background` | #e2e2e833 |
| `--surface-raised-image` | linear-gradient(180deg, #fafafa1a 0%, #fafafa00 48%, #1717191f 100%) |
| `--surface-raised-shadow` | inset 0px 1px 0px 0px #fafafa3d, inset 0px -1px 0px 0px #1717193d |
| `--surface-recessed-image` | linear-gradient(180deg, #1717191f 0%, #17171900 55%) |
| `--surface-recessed-shadow` | inset 0px 1px 2px 0px #17171933, inset 0px -1px 0px 0px #fafafa1f |
| `--space-zero` | 0px |
| `--space-xxs` | 4px |
| `--space-xs` | 8px |
| `--space-s` | 12px |
| `--space-m` | 16px |
| `--space-l` | 24px |
| `--space-xl` | 32px |
| `--space-xxl` | 48px |
| `--size-xxs` | 10px |
| `--line-xxs` | 14px |
| `--letter-spacing-xxs` | 0em |
| `--size-xs` | 12px |
| `--line-xs` | 16px |
| `--letter-spacing-xs` | 0em |
| `--size-s` | 14px |
| `--line-s` | 20px |
| `--letter-spacing-s` | -0.005em |
| `--size-m` | 16px |
| `--line-m` | 24px |
| `--letter-spacing-m` | -0.01em |
| `--size-l` | 24px |
| `--line-l` | 32px |
| `--letter-spacing-l` | -0.02em |
| `--size-xl` | 36px |
| `--line-xl` | 40px |
| `--letter-spacing-xl` | -0.025em |
| `--size-xxl` | 48px |
| `--line-xxl` | 52px |
| `--letter-spacing-xxl` | -0.035em |
| `--radius-zero` | 0px |
| `--radius-xs` | 4px |
| `--radius-s` | 8px |
| `--radius-m` | 12px |
| `--radius-l` | 20px |
| `--radius-xl` | 28px |
| `--radius-full` | 9999px |
| `--border-none` | 0px |
| `--border-s` | 1px |
| `--border-m` | 1px |
| `--border-l` | 2px |
| `--border-default-color` | #80808a33 |
| `--border-shadow-none` | 0 0 0 0 transparent |
| `--border-shadow-s` | inset 0 0 0 1px #80808a33 |
| `--border-shadow-m` | inset 0 0 0 1px #80808a33 |
| `--border-shadow-l` | inset 0 0 0 2px #80808a33 |
| `--font-ui` | "GT America", sans-serif |
| `--weight-ui-regular` | 400 |
| `--weight-ui-medium` | 500 |
| `--weight-ui-heavy` | 600 |
| `--font-brand` | "GT America", sans-serif |
| `--weight-brand-regular` | 400 |
| `--weight-brand-medium` | 500 |
| `--weight-brand-heavy` | 600 |
| `--font-editorial` | "GT America", sans-serif |
| `--weight-editorial-regular` | 400 |
| `--weight-editorial-medium` | 500 |
| `--weight-editorial-heavy` | 600 |
| `--font-data` | "GT America", sans-serif |
| `--weight-data-regular` | 400 |
| `--weight-data-medium` | 500 |
| `--weight-data-heavy` | 600 |
| `--color-none` | transparent |
| `--color-1` | #e2e2e8 |
| `--color-1-transparent` | #e2e2e833 |
| `--color-2` | #8c8983 |
| `--color-2-transparent` | #8c898333 |
| `--color-3` | #8daab8 |
| `--color-3-transparent` | #8daab833 |
| `--color-4` | #bca58d |
| `--color-4-transparent` | #bca58d33 |
| `--neutral-1` | #171719 |
| `--neutral-1-transparent` | #17171933 |
| `--neutral-2` | #202023 |
| `--neutral-2-transparent` | #20202333 |
| `--neutral-3` | #2a2a2e |
| `--neutral-3-transparent` | #2a2a2e33 |
| `--neutral-4` | #3b3b40 |
| `--neutral-4-transparent` | #3b3b4033 |
| `--neutral-5` | #55555d |
| `--neutral-5-transparent` | #55555d33 |
| `--neutral-6` | #80808a |
| `--neutral-6-transparent` | #80808a33 |
| `--neutral-7` | #ababB4 |
| `--neutral-7-transparent` | #ababB433 |
| `--neutral-8` | #cdCDD3 |
| `--neutral-8-transparent` | #cdCDD333 |
| `--neutral-9` | #e8e8ed |
| `--neutral-9-transparent` | #e8e8ed33 |
| `--neutral-10` | #fafafa |
| `--neutral-10-transparent` | #fafafa33 |
| `--success` | #8fd5ad |
| `--success-transparent` | #8fd5ad33 |
| `--warning` | #e5c279 |
| `--warning-transparent` | #e5c27933 |
| `--error` | #f49fa5 |
| `--error-transparent` | #f49fa533 |
| `--shadow-none` | none |
| `--shadow-s` | 0px 0.25px 0.75px 0px #1717190d, 0px 1px 3px 0px #17171913 |
| `--shadow-m` | 0px 1px 4px 0px #1717190b, 0px 4px 16px 0px #17171910 |
| `--shadow-l` | 0px 3px 9px 0px #1717190f, 0px 12px 36px 0px #17171916 |
| `--cte-canvas` | #171719 |
| `--cte-surface` | #202023 |
| `--cte-surface-muted` | #2a2a2e |
| `--cte-text` | #fafafa |
| `--cte-text-muted` | #ababB4 |
| `--cte-border` | #80808a33 |
| `--cte-accent` | #e2e2e8 |
| `--cte-accent-text` | #202023 |
| `--cte-danger` | #f49fa5 |
| `--cte-focus` | #e2e2e8 |
| `--cte-font` | "GT America", sans-serif |
| `--cte-font-size` | 14px |
| `--cte-font-weight` | 400 |
| `--cte-line-height` | 20px |
| `--cte-letter-spacing` | -0.005em |
| `--cte-detail-font-size` | 12px |
| `--cte-detail-line-height` | 16px |
| `--cte-detail-letter-spacing` | 0em |

## Authored component assignments

These are project edits. The [component reference](vnl-lj-components.md) includes the effective assignments with defaults and shared parts resolved.

```json
{
  "componentTokens": {
    "button:outline:rest": {
      "borderColor": "neutral-6-transparent"
    },
    "button:primary:rest": {
      "shadow": "s",
      "borderColor": "neutral-6-transparent"
    },
    "button:primary:focus": {
      "shadow": "s",
      "borderColor": "neutral-7-transparent"
    },
    "button:primary:hover": {
      "shadow": "s",
      "borderColor": "neutral-7-transparent"
    },
    "button:secondary:rest": {
      "shadow": "s",
      "background": "neutral-1",
      "borderColor": "neutral-6-transparent"
    },
    "button:secondary:focus": {
      "shadow": "s",
      "background": "neutral-2",
      "borderColor": "neutral-7-transparent"
    },
    "button:secondary:hover": {
      "shadow": "s",
      "background": "neutral-2",
      "borderColor": "neutral-7-transparent"
    }
  },
  "componentVariants": {}
}
```
