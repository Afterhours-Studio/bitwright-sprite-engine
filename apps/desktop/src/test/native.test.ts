// Bitwright - Sprite Engine
// Copyright (C) 2026 Afterhours Studio
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

/**
 * No native controls.
 *
 * A native form control draws with the platform's own chrome and ignores the
 * theme, so it looks wrong in both modes and cannot follow the role tokens. A
 * native `title` tooltip is the operating system's own box, which the studio
 * cannot style or position. This test parses every `.tsx` file under `src`
 * outside `components/ui` with the TypeScript compiler API and reports each
 * banned element, input type, or attribute. The fix is to use the components in
 * `components/ui` (Select, Checkbox, Slider, Disclosure, NumberField,
 * TextAreaField, Tooltip, and the rest). See docs/plan/NATIVE-CONTROLS.md.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

/** Lowercase DOM elements that render a native control or a native widget. */
const BANNED_TAGS = new Set([
  'select',
  'option',
  'details',
  'summary',
  'progress',
  'meter',
  'datalist',
  'textarea',
]);

/** `<input type>` values whose control is drawn by the platform. */
const BANNED_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'color',
  'number',
  'date',
  'file',
]);

/** A check returns the reason an element is banned, or nothing if it is allowed. */
type Check = (element: ts.JsxOpeningLikeElement, source: ts.SourceFile) => string | undefined;

/**
 * Lists every source file under a directory.
 *
 * @param directory - Where to start.
 * @returns Absolute paths of every file found.
 */
function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * Turns an absolute path into one relative to the app root, with forward slashes.
 *
 * @param path - Absolute path.
 * @returns The relative path, as the reports print it.
 */
function display(path: string): string {
  return relative(process.cwd(), path).split(sep).join('/');
}

/**
 * Reads the value of a JSX attribute when it is a string, in either the
 * `type="x"` form or the `type={"x"}` form.
 *
 * @param attribute - The attribute.
 * @returns The string value, or undefined when it is not a literal string.
 */
function stringValue(attribute: ts.JsxAttribute): string | undefined {
  const initializer = attribute.initializer;
  if (initializer === undefined) {
    return undefined;
  }
  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }
  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression !== undefined &&
    (ts.isStringLiteral(initializer.expression) ||
      ts.isNoSubstitutionTemplateLiteral(initializer.expression))
  ) {
    return initializer.expression.text;
  }
  return undefined;
}

/**
 * Finds the JSX attribute with a given name on an element.
 *
 * @param element - The opening element or self-closing element.
 * @param name - The attribute name.
 * @returns The attribute, or undefined when the element does not set it.
 */
function attributeNamed(
  element: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | undefined {
  for (const property of element.attributes.properties) {
    if (ts.isJsxAttribute(property) && property.name.getText() === name) {
      return property;
    }
  }
  return undefined;
}

/** Bans the native element names. */
const bannedTag: Check = (element) => {
  const tag = element.tagName.getText();
  return BANNED_TAGS.has(tag) ? `${tag} is a native control; use components/ui` : undefined;
};

/** Bans the native `<input>` types. */
const bannedInputType: Check = (element) => {
  if (element.tagName.getText() !== 'input') {
    return undefined;
  }
  const type = attributeNamed(element, 'type');
  const value = type === undefined ? undefined : stringValue(type);
  return value !== undefined && BANNED_INPUT_TYPES.has(value)
    ? `input type="${value}" is a native control; use components/ui`
    : undefined;
};

/** Bans the `title` attribute on a DOM element; Tooltip wraps it instead. */
const bannedTitle: Check = (element) => {
  return attributeNamed(element, 'title') !== undefined
    ? 'title attribute is a native tooltip; wrap in Tooltip'
    : undefined;
};

/**
 * Parses each file outside components/ui and reports every element the check bans.
 *
 * @param check - The rule to apply to each lowercase JSX element.
 * @returns One `relative/path:line <tag> <reason>` line per violation.
 */
function scan(check: Check): string[] {
  const files = walk(SRC).filter((path) => {
    const relativePath = display(path);
    return (
      /\.tsx$/.test(path) &&
      !/\.test\.tsx$/.test(path) &&
      !relativePath.startsWith('src/components/ui/')
    );
  });

  return files.flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const found: string[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName;
        // Only lowercase identifiers are DOM elements. A component such as
        // <Select> or a member such as <motion.div> is not checked here.
        if (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) {
          const reason = check(node, source);
          if (reason !== undefined) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            found.push(`${display(path)}:${line} ${tag.text} ${reason}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
    return found;
  });
}

describe('native controls', () => {
  it('finds source files to check', () => {
    const files = walk(SRC).filter((path) => /\.tsx$/.test(path));
    expect(files.length).toBeGreaterThan(0);
  });

  it('renders no native form control or widget element outside components/ui', () => {
    expect(scan(bannedTag)).toEqual([]);
  });

  it('renders no native input type outside components/ui', () => {
    expect(scan(bannedInputType)).toEqual([]);
  });

  it('sets no title attribute on a DOM element outside components/ui', () => {
    expect(scan(bannedTitle)).toEqual([]);
  });
});
