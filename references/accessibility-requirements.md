<!-- Governing: ADR-0019 (Frontend Quality Standards), SPEC-0016 REQ "Accessibility Requirements for UI Specs" -->

# Accessibility Requirements Reference

The full accessibility checklist behind the compact `## Accessibility Requirements` section that `/sdd:spec` injects into UI-facing specs. The spec carries the six normative one-liners; this file carries the detail an implementer or reviewer needs when applying them. It is the only copy — do not paste it into specs.

`/sdd:work`, `/sdd:review`, and `/sdd:check` consult this file when a spec's Accessibility Requirements section is in play.

## WCAG 2.1 AA Compliance

All UI components produced by this spec MUST meet WCAG 2.1 Level AA conformance as the minimum accessibility target.

## ARIA Landmarks

Page structure elements MUST include ARIA landmark roles:
- `role="banner"` on the site header
- `role="navigation"` on navigation regions
- `role="main"` on the primary content area
- `role="contentinfo"` on the site footer

## Icon-Only Controls

All icon-only controls (buttons, links) that have no visible text label MUST include an `aria-label` attribute describing the control's purpose.

## Dynamic Content Regions

Dynamically updated content (HTMX swaps, auto-refresh panels, real-time status updates) MUST use `aria-live` regions:
- `aria-live="polite"` for non-urgent updates
- `aria-live="assertive"` for critical status changes

## Keyboard Navigation

All interactive elements MUST be operable via keyboard:
- Logical tab order following visual layout
- Enter/Space to activate buttons and controls
- Escape to dismiss popups, dropdowns, and dialogs
- Arrow keys for navigation within composite widgets (tabs, menus, tree views)

## Focus Management

Modals and dialogs MUST implement focus management:
- Focus MUST be trapped within the modal when open (Tab/Shift+Tab cycles within the modal)
- Focus MUST move to the modal's first focusable element on open
- Focus MUST return to the triggering element when the modal is closed
