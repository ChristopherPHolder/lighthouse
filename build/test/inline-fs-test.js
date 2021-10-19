/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const fs = require('fs');
const path = require('path');
const {inlineFs} = require('../plugins/inline-fs.js');

const {LH_ROOT} = require('../../root.js');
const contextPath = `${LH_ROOT}/lighthouse-core/index.js`;

describe('inline-fs', () => {
  const tmpPath = `${LH_ROOT}/.tmp/inline-fs/test.txt`;
  const tmpDir = path.dirname(tmpPath);

  beforeAll(() => {
    fs.mkdirSync(tmpDir, {recursive: true});
  });

  afterAll(() => {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  });

  describe('supported syntax', () => {
    it('returns null for content with no fs calls', async () => {
      const content = 'const val = 1;';
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({code: null});
    });

    it('returns null for non-call references to fs methods', async () => {
      const content = 'const val = fs.readFileSync ? 1 : 2;';
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({code: null});
    });

    it('evaluates an fs.readFileSync call and inlines the contents', async () => {
      fs.writeFileSync(tmpPath, 'template literal text content');

      const content = `const myTextContent = fs.readFileSync('${tmpPath}', 'utf8');`;
      const {code, warnings} = await inlineFs(content, contextPath);
      expect(code).toBe(`const myTextContent = "template literal text content";`);
      expect(warnings).toEqual([]);
    });

    it('gives a warning and skips invalid syntax in fs call', async () => {
      // eslint-disable-next-line max-len
      const content = `const firstThing = 5;\nconst myContent = fs.readFileSync(\\filePathVar, 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: null,
        warnings: [{
          text: 'Expecting Unicode escape sequence \\uXXXX (2:35)',
          location: {
            file: contextPath,
            line: 2,
            column: 35,
            lineText: `fs.readFileSync(\\filePathVar, 'utf8');`,
          },
        }],
      });
    });

    it('gives a warning and skips unrecognized identifiers', async () => {
      const content = `const myContent = fs.readFileSync(filePathVar, 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: null,
        warnings: [{
          text: `unsupported identifier 'filePathVar'`,
          location: {
            file: contextPath,
            line: 1,
            column: 18,
            lineText: `fs.readFileSync(filePathVar, 'utf8')`,
          },
        }],
      });
    });

    it('gives a warning and skips unsupported expressions inside arguments', async () => {
      const content = `const myContent = fs.readFileSync(function() {return 'path/'}, 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: null,
        warnings: [{
          text: `unsupported node: FunctionExpression`,
          location: {
            file: contextPath,
            line: 1,
            column: 18,
            lineText: `fs.readFileSync(function() {return 'path/'}, 'utf8')`,
          },
        }],
      });
    });

    it('warns and skips unsupported syntax but inlines subsequent fs method calls', async () => {
      fs.writeFileSync(tmpPath, 'template literal text content');

      // eslint-disable-next-line max-len
      const content = `const myContent = fs.readFileSync(filePathVar, 'utf8');\nconst replacedContent = fs.readFileSync('${tmpPath}', 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        // eslint-disable-next-line max-len
        code: `const myContent = fs.readFileSync(filePathVar, 'utf8');\nconst replacedContent = "template literal text content";`,
        warnings: [{
          text: `unsupported identifier 'filePathVar'`,
          location: {
            file: contextPath,
            line: 1,
            column: 18,
            lineText: `fs.readFileSync(filePathVar, 'utf8')`,
          },
        }],
      });
    });

    it('substitutes `__dirname`', async () => {
      fs.writeFileSync(tmpPath, '__dirname text content');

      const dirnamePath = `__dirname + '/../.tmp/inline-fs/test.txt'`;
      const content = `const myTextContent = fs.readFileSync(${dirnamePath}, 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: `const myTextContent = "__dirname text content";`,
        warnings: [],
      });
    });

    it('runs `require.resolve`', async () => {
      // eslint-disable-next-line max-len
      const content = `const myTextContent = fs.readFileSync(require.resolve('axe-core/README.md'), 'utf8');`;
      const result = await inlineFs(content, contextPath);

      const axeReadme = fs.readFileSync(require.resolve('axe-core/README.md'), 'utf8');
      expect(axeReadme.length).toBeGreaterThan(500);
      expect(result).toEqual({
        code: `const myTextContent = ${JSON.stringify(axeReadme)};`,
        warnings: [],
      });
    });

    it('concats strings', async () => {
      fs.writeFileSync(tmpPath, 'concat text content');

      const concatPath = `__dirname + '/../' + '.tmp/inline-fs/test.txt'`;
      const content = `const myTextContent = fs.readFileSync(${concatPath}, 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: `const myTextContent = "concat text content";`,
        warnings: [],
      });
    });

    it('evaluates template literals', async () => {
      fs.writeFileSync(tmpPath, 'template literal text content');

      const templatePath = '`${__dirname}/../.tmp/${"inline-fs"}/test.txt`';
      const content = `const myTextContent = fs.readFileSync(${templatePath}, 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: `const myTextContent = "template literal text content";`,
        warnings: [],
      });
    });

    it('evaluates expressions in template literals', async () => {
      fs.writeFileSync(tmpPath, 'more template literal text content');

      const templatePath = `\`\${__dirname}/\${path.relative(__dirname, '${tmpPath}')}\``;
      const content = `const myTextContent = fs.readFileSync(${templatePath}, 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: `const myTextContent = "more template literal text content";`,
        warnings: [],
      });
    });

    it('evaluates expressions in `require.resolve` calls', async () => {
      // eslint-disable-next-line max-len
      const content = `const myTextContent = fs.readFileSync(require.resolve('axe-core' + \`/READ${'ME'}.md\`), 'utf8');`;
      const result = await inlineFs(content, contextPath);

      const axeReadme = fs.readFileSync(require.resolve('axe-core/README.md'), 'utf8');
      expect(axeReadme.length).toBeGreaterThan(500);
      expect(result).toEqual({
        code: `const myTextContent = ${JSON.stringify(axeReadme)};`,
        warnings: [],
      });
    });

    it('warns and skips on unsupported path methods', async () => {
      // eslint-disable-next-line max-len
      const content = `const myTextContent = fs.readFileSync(path.isAbsolute('${tmpPath}'), 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: null,
        warnings: [{
          text: `'path.isAbsolute' is not supported with 'fs' function calls`,
          location: {
            file: contextPath,
            line: 1,
            column: 22,
            lineText: expect.stringMatching(/^fs\.readFileSync\(path.isAbsolute/),
          },
        }],
      });
    });

    // TODO(bckenny): zero length path.resolve() (resolves to cwd?)
    // syntax errors, warnings but resume on unsupported syntax
  });

  describe('fs.readFileSync', () => {
    it('inlines content from fs.readFileSync calls', async () => {
      fs.writeFileSync(tmpPath, 'some text content');
      const content = `const myTextContent = fs.readFileSync('${tmpPath}', 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: `const myTextContent = "some text content";`,
        warnings: [],
      });
    });

    it('inlines content with quotes', async () => {
      fs.writeFileSync(tmpPath, `"quoted", and an unbalanced quote: "`);
      const content = `const myTextContent = fs.readFileSync('${tmpPath}', 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: `const myTextContent = "\\"quoted\\", and an unbalanced quote: \\"";`,
        warnings: [],
      });
    });

    it('inlines multiple fs.readFileSync calls', async () => {
      fs.writeFileSync(tmpPath, 'some text content');
      // eslint-disable-next-line max-len
      const content = `fs.readFileSync('${tmpPath}', 'utf8')fs.readFileSync(require.resolve('${tmpPath}'), 'utf8')`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: `"some text content""some text content"`,
        warnings: [],
      });
    });

    it('warns and skips on nested fs.readFileSync calls', async () => {
      fs.writeFileSync(tmpPath, contextPath);
      // eslint-disable-next-line max-len
      const content = `const myTextContent = fs.readFileSync(fs.readFileSync('${tmpPath}', 'utf8'), 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: `const myTextContent = fs.readFileSync("${contextPath}", 'utf8');`,
        warnings: [{
          // eslint-disable-next-line max-len
          text: 'Only `require.resolve()` and `path` methods are supported within `fs` function calls',
          location: {
            file: contextPath,
            line: 1,
            column: 22,
            lineText: `fs.readFileSync(fs.readFileSync('${tmpPath}', 'utf8'), 'utf8')`,
          },
        }],
      });
    });

    it('executes path methods to determine the file to read', async () => {
      const fileContents = 'some tricky-to-get text content';
      fs.writeFileSync(tmpPath, fileContents);

      // eslint-disable-next-line max-len
      const content = `const myTextContent = fs.readFileSync(path.join(path.dirname('${tmpPath}'), path.basename('${tmpPath}')), 'utf8');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: `const myTextContent = "${fileContents}";`,
        warnings: [],
      });
    });

    it('inlines content from fs.readFileSync with variants of utf8 options', async () => {
      fs.writeFileSync(tmpPath, 'some text content');

      const utf8Variants = [
        `'utf8'`,
        `'utf-8'`,
        `{encoding: 'utf8'}`,
        `{encoding: 'utf-8'}`,
        `{encoding: 'utf8', nonsense: 'flag'}`,
      ];

      for (const opts of utf8Variants) {
        const content = `const myTextContent = fs.readFileSync('${tmpPath}', ${opts});`;
        const result = await inlineFs(content, contextPath);
        expect(result).toEqual({
          code: `const myTextContent = "some text content";`,
          warnings: [],
        });
      }
    });

    // TODO(bckenny): minifies inlined js
  });

  describe('fs.readdirSync', () => {
    it('inlines content from fs.readdirSync calls', async () => {
      fs.writeFileSync(tmpPath, 'text');
      const content = `const files = fs.readdirSync('${tmpDir}');`;
      const result = await inlineFs(content, contextPath);
      const tmpFilename = path.basename(tmpPath);
      expect(result).toEqual({
        code: `const files = ["${tmpFilename}"];`,
        warnings: [],
      });
    });

    it('handles methods chained on fs.readdirSync result', async () => {
      fs.writeFileSync(tmpPath, 'text');
      // eslint-disable-next-line max-len
      const content = `const files = [...fs.readdirSync('${tmpDir}'), ...fs.readdirSync('${tmpDir}').map(f => \`metrics/\${f}\`)]`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: 'const files = [...["test.txt"], ...["test.txt"].map(f => `metrics/${f}`)]',
        warnings: [],
      });
    });

    it('inlines content from fs.readdirSync with variants of utf8 options', async () => {
      fs.writeFileSync(tmpPath, 'text');
      const tmpFilename = path.basename(tmpPath);

      const utf8Variants = [
        '', // `options` are optional for readdirSync, so include missing opts.
        `'utf8'`,
        `'utf-8'`,
        `{encoding: 'utf8'}`,
        `{encoding: 'utf-8'}`,
        `{encoding: 'utf8', nonsense: 'flag'}`,
      ];

      for (const opts of utf8Variants) {
        // Trailing comma has no effect in missing opts case.
        const content = `const files = fs.readdirSync('${tmpDir}', ${opts});`;
        const result = await inlineFs(content, contextPath);
        expect(result).toEqual({
          code: `const files = ["${tmpFilename}"];`,
          warnings: [],
        });
      }
    });

    it('throws when trying to fs.readdirSync a non-existent directory', async () => {
      const nonsenseDir = `${LH_ROOT}/.tmp/nonsense-path/`;
      const content = `const files = fs.readdirSync('${nonsenseDir}');`;
      const result = await inlineFs(content, contextPath);
      expect(result).toEqual({
        code: null,
        warnings: [{
          // eslint-disable-next-line max-len
          text: expect.stringMatching(/^could not inline fs\.readdirSync.+ENOENT.+nonsense-path\/'$/),
          location: {
            file: contextPath,
            line: 1,
            column: 14,
            lineText: `fs.readdirSync('${nonsenseDir}')`,
          },
        }],
      });
    });
  });
});
