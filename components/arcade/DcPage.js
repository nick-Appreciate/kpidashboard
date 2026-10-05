'use client';

import { createElement, Fragment, useEffect, useMemo, useReducer, useRef } from 'react';

// A small runtime for claude.ai design-canvas pages (*.dc.html), so the same
// arcade source that publishes as an artifact also runs inside this app.
//
// It supports what arcade/src/Main.dc.html uses: an <x-dc> template with
// {{dotted.path}} holes in text and attributes, <sc-for list as>, <sc-if value>,
// <helmet> (rendered in place), and a `class Component extends DCLogic` script
// whose renderVals() supplies the values. setState merges synchronously and
// re-renders, matching the canvas runtime.

class DCLogic {
  constructor(props) {
    this.props = props || {};
    this.state = {};
  }

  setState(update) {
    const next = typeof update === 'function' ? update(this.state) : update;
    this.state = { ...this.state, ...next };
    if (this.__rerender) this.__rerender();
  }
}

const HOLE = /\{\{\s*([\w$.]+)\s*\}\}/g;
const ONLY_HOLE = /^\{\{\s*([\w$.]+)\s*\}\}$/;
// Parents where whitespace text nodes are invalid or meaningless.
const NO_TEXT = new Set(['select', 'optgroup', 'ol', 'ul', 'svg', 'g', 'table', 'thead', 'tbody', 'tr', 'x-dc', 'helmet']);
const EVENTS = { onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onsubmit: 'onSubmit' };
const RENAME = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', viewbox: 'viewBox' };

const lookup = (scope, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), scope);
const fill = (text, scope) => text.replace(HOLE, (_, p) => { const v = lookup(scope, p); return v == null ? '' : String(v); });
const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function styleObject(css) {
  const out = {};
  // Split on semicolons that are not inside parentheses (url(...), calc(...)).
  let depth = 0, start = 0;
  const parts = [];
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '(') depth++;
    else if (css[i] === ')') depth--;
    else if (css[i] === ';' && depth === 0) { parts.push(css.slice(start, i)); start = i + 1; }
  }
  parts.push(css.slice(start));
  parts.forEach((decl) => {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const prop = decl.slice(0, i).trim();
    if (!prop) return;
    out[prop.startsWith('--') ? prop : camel(prop)] = decl.slice(i + 1).trim();
  });
  return out;
}

function propsOf(el, scope) {
  const props = {};
  for (const { name, value } of Array.from(el.attributes)) {
    if (name.startsWith('hint-')) continue;
    const only = value.match(ONLY_HOLE);
    if (EVENTS[name]) { props[EVENTS[name]] = only ? lookup(scope, only[1]) : undefined; continue; }
    if (name === 'style') { props.style = styleObject(fill(value, scope)); continue; }
    const key = RENAME[name] || (name.startsWith('aria-') || name.startsWith('data-') ? name : camel(name));
    props[key] = only ? lookup(scope, only[1]) : fill(value, scope);
  }
  // A select with a value but no handler would be read-only; DC pages always pair them.
  return props;
}

function renderChildren(node, scope) {
  const out = [];
  const parent = node.localName;
  node.childNodes.forEach((child, i) => {
    const r = renderNode(child, scope, parent, i);
    if (r !== null && r !== undefined) out.push(r);
  });
  return out;
}

function renderNode(node, scope, parentTag, index) {
  if (node.nodeType === 3) {
    const text = node.nodeValue;
    if (!text.trim()) return NO_TEXT.has(parentTag) ? null : ' ';
    return fill(text, scope);
  }
  if (node.nodeType !== 1) return null;
  const tag = node.localName;

  if (tag === 'sc-for') {
    const list = lookup(scope, (node.getAttribute('list') || '').replace(/[{}\s]/g, '')) || [];
    const as = node.getAttribute('as');
    return list.map((item, i) => createElement(Fragment, { key: (item && item.key) ?? i }, ...renderChildren(node, { ...scope, [as]: item })));
  }
  if (tag === 'sc-if') {
    const v = lookup(scope, (node.getAttribute('value') || '').replace(/[{}\s]/g, ''));
    return v ? createElement(Fragment, { key: 'if' + index }, ...renderChildren(node, scope)) : null;
  }
  if (tag === 'helmet' || tag === 'x-dc') return createElement(Fragment, { key: tag + index }, ...renderChildren(node, scope));
  if (tag === 'style') return createElement('style', { key: 'style' + index, dangerouslySetInnerHTML: { __html: node.textContent } });

  const props = propsOf(node, scope);
  props.key = index;
  return createElement(tag, props, ...renderChildren(node, scope));
}

function parsePage(page) {
  const doc = new DOMParser().parseFromString(page, 'text/html');
  const root = doc.querySelector('x-dc');
  const script = doc.querySelector('script[data-dc-script]');
  if (!root || !script) throw new Error('Not a design-canvas page: missing <x-dc> or its script');
  // eslint-disable-next-line no-new-func
  const Component = new Function('DCLogic', script.textContent + '\nreturn Component;')(DCLogic);
  return { root, Component };
}

export default function DcPage({ page, props }) {
  const { root, Component } = useMemo(() => parsePage(page), [page]);
  const [, rerender] = useReducer((n) => n + 1, 0);
  const inst = useRef(null);
  if (!inst.current || !(inst.current instanceof Component)) inst.current = new Component(props || {});

  useEffect(() => {
    const logic = inst.current;
    logic.__rerender = rerender;
    if (logic.componentDidMount) logic.componentDidMount();
    return () => {
      logic.__rerender = null;
      if (logic.componentWillUnmount) logic.componentWillUnmount();
    };
  }, [Component]);

  const vals = inst.current.renderVals();
  return createElement(Fragment, null, ...renderChildren(root, vals));
}
