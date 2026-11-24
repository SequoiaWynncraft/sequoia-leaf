/**
 * The repository's own lint rules, an oxlint JS plugin (`jsPlugins` in `.oxlintrc.json`):
 *
 * - `leaf/raw-browser`: the browser's listeners, timers, frames, observers and sockets are asked of
 *   a scope (`packages/kit/src/scope.ts`), which lets go of them with their owner;
 * - `leaf/module-let`: no `let` at the top of a module, where state has no owner;
 * - `leaf/hook-framework`: no hook framework loaded by `require` or a template `import()`, which
 *   `no-restricted-imports` does not see.
 */

const hookFramework = /^(react|preact|solid-js|vue)(\/|$)/;
const globals = new Set(["window", "self", "globalThis", "global"]);
const calls = new Set(["setTimeout", "setInterval", "requestAnimationFrame"]);
const constructors = new Set(["MutationObserver", "ResizeObserver", "WebSocket"]);

/** The name a callee or member reads: `f`, `a.f`, `a["f"]`. */
function nameOf(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type !== "MemberExpression") return undefined;
  if (!node.computed) return node.property.name;
  return typeof node.property.value === "string" ? node.property.value : undefined;
}

/** A global read bare (`setTimeout`) or off the global object (`window.setTimeout`). */
const global = (node) =>
  node.type === "Identifier" ||
  (node.type === "MemberExpression" && node.object.type === "Identifier" && globals.has(node.object.name));

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
    return {
      CallExpression(node) {
        const name = nameOf(node.callee);
        if (name === "addEventListener" || (calls.has(name) && global(node.callee))) report(node.callee, name);
      },
      NewExpression(node) {
        const name = nameOf(node.callee);
        if (constructors.has(name) && global(node.callee)) report(node.callee, `new ${name}`);
      },
      // `addEventListener` taken as a value, or out of an object.
      MemberExpression(node) {
        if (nameOf(node) !== "addEventListener") return;
        if (node.parent.type === "CallExpression" && node.parent.callee === node) return;
        report(node, "addEventListener");
      },
      Property(node) {
        if (node.parent.type !== "ObjectPattern") return;
        const name = node.computed ? node.key.value : (node.key.name ?? node.key.value);
        if (name === "addEventListener") report(node.key, name);
      },
    };
  },
};

export default {
  meta: { name: "leaf" },
  rules: { "raw-browser": rawBrowser, "module-let": moduleLet, "hook-framework": hookFrameworkRule },
};
