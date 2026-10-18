import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

// Pages must style with the semantic tokens (bg-card, text-muted-foreground,
// border-border, etc. — defined in src/app/globals.css with a .dark override
// block) instead of raw gray-* palette classes, so dark-mode correctness lives
// in the theme rather than in per-element dark: twins. See issue #35. The few
// genuinely intentional raw grays (e.g. the always-dark footer on the landing
// page) are marked with an eslint-disable comment and an explanation.
const noRawGrayClasses = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ban raw gray-* Tailwind classes in page code; use semantic tokens instead",
    },
    messages: {
      grayClass:
        'Use a semantic token instead of raw "{{ cls }}" (bg-card, text-muted-foreground, border-border, etc. from src/app/globals.css) so the page stays correct in both themes.',
    },
    schema: [],
  },
  create(context) {
    // Matches color-role utilities (with optional variant prefixes like
    // dark:/hover:/group-hover:) against the Tailwind gray palette.
    const GRAY_RE =
      /((?:[a-z-]+:)?(?:bg|text|border|divide|ring|from|to|via|fill|stroke|outline|placeholder)-gray-(?:50|100|200|300|400|500|600|700|800|900|950))\b/g;

    function checkString(node, value) {
      if (typeof value !== "string") return;
      GRAY_RE.lastIndex = 0;
      let match;
      while ((match = GRAY_RE.exec(value)) !== null) {
        context.report({
          node,
          messageId: "grayClass",
          data: { cls: match[1] },
        });
      }
    }

    // Recurse into className expressions so classes hidden in ternaries or
    // template interpolations (e.g. `... ${x ? 'bg-green-500' : 'bg-gray-300'}`)
    // are caught too — the class strings live in Literals either way.
    function visitExpression(node) {
      if (!node) return;
      if (node.type === "Literal" && typeof node.value === "string") {
        checkString(node, node.value);
      } else if (node.type === "TemplateLiteral") {
        for (const quasi of node.quasis) checkString(node, quasi.value.cooked);
        for (const expr of node.expressions) visitExpression(expr);
      } else if (node.type === "ConditionalExpression") {
        visitExpression(node.consequent);
        visitExpression(node.alternate);
      }
    }

    return {
      JSXAttribute(node) {
        if (
          node.name.type !== "JSXIdentifier" ||
          node.name.name !== "className"
        ) {
          return;
        }
        const value = node.value;
        if (!value) return;
        if (value.type === "Literal") {
          checkString(node, value.value);
        } else if (value.type === "JSXExpressionContainer") {
          visitExpression(value.expression);
        }
      },
    };
  },
};

// jsx-a11y's control-has-associated-label treats ANY child component as
// possible label text, so an icon-only <button><X /></button> passes it and is
// announced as just "button" (#231). This rule closes that gap: a button/link
// whose children are only elements (no text, no expression, no sr-only text)
// must carry aria-label / aria-labelledby / title.
const noUnnamedIconControls = {
  meta: {
    type: "problem",
    docs: { description: "Icon-only interactive controls need an accessible name" },
    messages: {
      unnamed:
        "<{{ name }}> has no accessible name: its children are only icons/elements. Add aria-label (or aria-labelledby / visible text).",
    },
    schema: [],
  },
  create(context) {
    const CONTROLS = new Set(["button", "Button", "a", "Link", "SheetTrigger", "DialogTrigger"]);
    const NAME_ATTRS = new Set(["aria-label", "aria-labelledby", "title"]);

    function hasText(child) {
      if (child.type === "JSXText") return child.value.trim().length > 0;
      // {expression}: assume it can render text.
      if (child.type === "JSXExpressionContainer") {
        return child.expression.type !== "JSXEmptyExpression";
      }
      if (child.type === "JSXElement") {
        const el = child.openingElement.name;
        // An sr-only span is the other conventional way to name an icon control.
        const cls = child.openingElement.attributes.find(
          (a) => a.type === "JSXAttribute" && a.name.name === "className",
        );
        if (
          el.type === "JSXIdentifier" &&
          cls?.value?.type === "Literal" &&
          String(cls.value.value).split(/\s+/).includes("sr-only")
        ) {
          return true;
        }
        return child.children.some(hasText);
      }
      return false;
    }

    return {
      JSXElement(node) {
        const opening = node.openingElement;
        if (opening.name.type !== "JSXIdentifier" || !CONTROLS.has(opening.name.name)) return;
        const attrs = opening.attributes;
        if (attrs.some((a) => a.type === "JSXSpreadAttribute")) return;
        // asChild delegates to its child, which is checked on its own.
        if (attrs.some((a) => a.type === "JSXAttribute" && a.name.name === "asChild")) return;
        if (attrs.some((a) => a.type === "JSXAttribute" && NAME_ATTRS.has(a.name.name))) return;
        if (node.children.length === 0 && !attrs.length) return;
        if (node.children.some(hasText)) return;
        context.report({ node, messageId: "unnamed", data: { name: opening.name.name } });
      },
    };
  },
};

const ourdaoPlugin = {
  rules: {
    "no-raw-gray-classes": noRawGrayClasses,
    "no-unnamed-icon-controls": noUnnamedIconControls,
  },
};

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  // The plugin is already registered by eslint-config-next; only add the
  // recommended ruleset without re-declaring the plugin entry.
  {
    plugins: {},
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // "recommended" does not require an accessible NAME on interactive
      // elements — an icon-only <button> passes it and is announced as just
      // "button" (#231). These make a missing name a lint failure.
      "jsx-a11y/control-has-associated-label": [
        "error",
        {
          labelAttributes: ["aria-label", "aria-labelledby", "title"],
          controlComponents: ["Button", "Input", "Link"],
          depth: 5,
          ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video"],
          ignoreRoles: [
            "grid",
            "listbox",
            "menu",
            "menubar",
            "radiogroup",
            "row",
            "tablist",
            "toolbar",
            "tree",
            "treegrid",
          ],
        },
      ],
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/label-has-associated-control": [
        "error",
        { assert: "either", depth: 4 },
      ],
    },
    settings: {
      // Teach the plugin that our wrapper components render these elements,
      // so <Button/> and <Input/> are checked like <button> and <input>.
      "jsx-a11y": {
        components: {
          Button: "button",
          Input: "input",
          Link: "a",
        },
      },
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "src/lib/generated/**",
    ],
  },
  {
    files: ["src/components/DocumentViewer.tsx"],
    rules: {
      // React's own documented data-fetching-in-effect pattern — setLoading(true)
      // synchronously at the top of the effect, see
      // https://react.dev/reference/react/useEffect#fetching-data-with-effects —
      // trips this rule (confirmed by isolating that exact example). This
      // component's password-gated decrypt flow doesn't map cleanly onto
      // React Query without a larger rewrite, so it's scoped to just this
      // file rather than weakening the guardrail everywhere.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { ourdao: ourdaoPlugin },
    rules: { "ourdao/no-unnamed-icon-controls": "error" },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    plugins: { ourdao: ourdaoPlugin },
    rules: {
      "ourdao/no-raw-gray-classes": "error",
    },
  },
];

export default eslintConfig;
