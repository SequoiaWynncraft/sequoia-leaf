/**
 * The repository's own lint rules, an oxlint JS plugin (`jsPlugins` in `.oxlintrc.json`):
 *
 * - `leaf/raw-browser`: the browser's listeners, timers, frames, observers and sockets are asked of
 *   a scope (`packages/kit/src/scope.ts`), which lets go of them with their owner. Any reference to
 *   one at run time is a hit, called, passed or kept, read bare or off the global object, and so is
 *   letting go of a timer or frame, which only the scope does; a name of the file's own is not;
 * - `leaf/module-let`: no `let` at the top of a module, where state has no owner;
 * - `leaf/hook-framework`: no hook framework loaded by `require` or a template `import()`, which
 *   `no-restricted-imports` does not see;
 * - `leaf/said-number`: a number a player reads is said by `packages/core/src/say.ts` (the pages take
 *   it from the kit's `say.ts`), so no file formats one its own way: no `toLocaleString`, no
 *   `Intl.NumberFormat`, no `maximumFractionDigits`, and no rate in words of its own, "/min" or a
 *   number "a minute" (a digit, or a value set into the words, before " a minute"). Prose that
 *   speaks of a minute with no number in it ("try again in a minute") is words, not a rate.
 */

const hookFramework = /^(react|preact|solid-js|vue)(\/|$)/;
/** The global object, by each name it goes by. */
const globals = new Set(["window", "self", "globalThis", "global"]);
/** What only a scope may touch: listening, waiting, ticking, frames, observers and sockets, and letting go of a timer or frame. */
const raw = new Set([
  "addEventListener",
  "removeEventListener",
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "MutationObserver",
  "ResizeObserver",
  "WebSocket",
  "clearTimeout",
  "clearInterval",
  "cancelAnimationFrame",
]);
/** What every event target has, an element as much as the global object. */
const listening = new Set(["addEventListener", "removeEventListener"]);

/** The name a member reads: `a.f`, `a["f"]`. */
function nameOf(node) {
  if (!node.computed) return node.property.name;
  return typeof node.property.value === "string" ? node.property.value : undefined;
}

const moduleLet = {
  meta: { schema: [] },
  create(context) {
    return {
      VariableDeclaration(node) {
        if (node.kind !== "let") return;
        const at = node.parent;
        if (at.type === "Program" || (at.type === "ExportNamedDeclaration" && at.parent.type === "Program"))
          context.report({ node, message: "No `let` at the top of a module: give the state an owner." });
      },
    };
  },
};

const hookFrameworkRule = {
  meta: { schema: [] },
  create(context) {
    const check = (node) => {
      const value =
        node?.type === "TemplateLiteral" && node.expressions.length === 0 ? node.quasis[0]?.value.cooked : node?.value;
      if (typeof value === "string" && hookFramework.test(value))
        context.report({ node, message: "No hook framework: the kit's scope owns what a component would." });
    };
    return {
      ImportExpression(node) {
        if (node.source.type === "TemplateLiteral") check(node.source);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require") check(node.arguments[0]);
      },
    };
  },
};

const rawBrowser = {
  meta: { schema: [] },
  create(context) {
    const report = (node, name) =>
      context.report({ node, message: `Ask a scope for this (\`${name}\`): packages/kit/src/scope.ts.` });
    /** Where the file reads the global object: each name of it that the file does not bind. */
    const theGlobal = new Set();
    return {
      // What the file reads at run time and does not bind itself, so the browser's: not a type, not `typeof` in one.
      // A global oxlint knows of (`globalThis`) is a variable of no definition; any other is read through.
      Program(node) {
        const global = context.sourceCode.getScope(node);
        const known = global.variables.filter((v) => v.defs.length === 0).flatMap((v) => v.references);
        for (const { identifier: id, isValueReference } of new Set([...global.through, ...known])) {
          if (!isValueReference || id.parent.type === "TSTypeQuery" || id.parent.type === "TSQualifiedName") continue;
          if (raw.has(id.name)) report(id, id.name);
          else if (globals.has(id.name)) theGlobal.add(id);
        }
      },
      // `el.addEventListener`, off anything; `window.setTimeout`, `globalThis["WebSocket"]`, off the global object.
      MemberExpression(node) {
        const name = nameOf(node);
        if (listening.has(name) || (raw.has(name) && theGlobal.has(node.object))) report(node, name);
      },
      // `{ addEventListener } = el`, out of anything; `{ setTimeout } = window`, out of the global object.
      Property(node) {
        if (node.parent.type !== "ObjectPattern") return;
        const name = node.computed ? node.key.value : (node.key.name ?? node.key.value);
        const from = node.parent.parent.init ?? node.parent.parent.right;
        if (listening.has(name) || (raw.has(name) && theGlobal.has(from))) report(node.key, name);
      },
    };
  },
};

/** What says a number its own way, by what it is called: a formatter, or what tells one how many places. */
const formats = new Set(["toLocaleString", "NumberFormat", "maximumFractionDigits", "minimumFractionDigits"]);

/** How words say a rate of their own, if they do: "/min", or " a minute" after a number; `afterValue` when a value is set into the words just before them. */
function rateIn(text, afterValue) {
  if (/\/min\b/.test(text)) return "/min";
  const at = text.indexOf(" a minute");
  return at >= 0 && (afterValue || /\d/.test(text.slice(0, at))) ? "a minute" : null;
}

const saidNumber = {
  meta: { schema: [] },
  create(context) {
    const report = (node, what) =>
      context.report({
        node,
        message: `Say this number with \`say.ts\` (\`${what}\`): packages/core/src/say.ts, or packages/kit/src/say.ts on a page.`,
      });
    return {
      // `v.toLocaleString()`, `new Intl.NumberFormat()`, off anything.
      MemberExpression(node) {
        const name = nameOf(node);
        if (formats.has(name)) report(node, name);
      },
      // `{ maximumFractionDigits: 1 }`.
      Property(node) {
        const name = node.computed ? node.key.value : (node.key.name ?? node.key.value);
        if (formats.has(name)) report(node.key, name);
      },
      Literal(node) {
        const said = typeof node.value === "string" ? rateIn(node.value, false) : null;
        if (said) report(node, said);
      },
      TemplateLiteral(node) {
        for (const [i, part] of node.quasis.entries()) {
          const said = rateIn(part.value.cooked ?? part.value.raw, i > 0);
          if (said) report(part, said);
        }
      },
    };
  },
};

export default {
  meta: { name: "leaf" },
  rules: {
    "raw-browser": rawBrowser,
    "module-let": moduleLet,
    "hook-framework": hookFrameworkRule,
    "said-number": saidNumber,
  },
};
