/**
 * @license
 * Copyright 2017 The Bazel Authors. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// taze: jasmine from //third_party/javascript/typings/jasmine:jasmine_without_externs
import * as ts from 'typescript';

import {checkModuleDeps} from './strict_deps';

describe('strict deps', () => {
  function createProgram(files: ts.MapLike<string>) {
    const options: ts.CompilerOptions = {
      noResolve: true,
      baseUrl: '/src',
      rootDirs: ['/src', '/src/blaze-bin'],
      paths: {'*': ['*', 'blaze-bin/*']},
      traceResolution: true
    };

    // Fake compiler host relying on `files` above.
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = function(fileName: string) {
      if (!files[fileName]) {
        return originalGetSourceFile(fileName, ts.ScriptTarget.Latest);
      }
      return ts.createSourceFile(
          fileName, files[fileName], ts.ScriptTarget.Latest);
    };

    // Fake module resolution host relying on `files` above.
    host.fileExists = (f) => !!files[f];
    host.directoryExists = () => true;
    host.realpath = (f) => f;
    const rf = host.readFile.bind(host);
    host.readFile = (f) => files[f] || rf(f);
    host.getCurrentDirectory = () => '/src';
    host.getDirectories = (path) => [];

    const p = ts.createProgram(Object.keys(files), options, host);
    const diags = [...ts.getPreEmitDiagnostics(p)];
    if (diags.length > 0) {
      throw new Error(ts.formatDiagnostics(diags, {
        getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
        getNewLine: () => ts.sys.newLine,
        getCanonicalFileName: (f: string) => f,
      }));
    }
    return p;
  }

  it('reports errors for transitive dependencies', () => {
    const p = createProgram({
      '/src/p/sd1.ts': 'export let x = 1;',
      '/src/p/sd2.ts': `import {x} from "./sd1";
          export let y = x;`,
      '/src/p/sd3.ts': `import {y} from "./sd2";
          import {x} from "./sd1";
          export let z = x + y;`,
    });
    const diags = checkModuleDeps(p, ['p/sd3.ts'], ['/src/p/sd2.ts'], '/src');
    expect(diags.length).toBe(1);
    expect(diags[0].messageText)
        .toMatch(/transitive dependency on p\/sd1.ts not allowed/);
  });

  it('reports errors for exports', () => {
    const p = createProgram({
      '/src/p/sd1.ts': 'export let x = 1;',
      '/src/p/sd2.ts': `import {x} from "./sd1";
          export let y = x;`,
      '/src/p/sd3.ts': `export {x} from "./sd1";`,
    });
    const diags = checkModuleDeps(p, ['p/sd3.ts'], ['/src/p/sd2.ts'], '/src');
    expect(diags.length).toBe(1);
    expect(diags[0].messageText)
        .toMatch(/transitive dependency on p\/sd1.ts not allowed/);
  });

  it('supports files mapped in blaze-bin', () => {
    const p = createProgram({
      '/src/blaze-bin/p/sd1.ts': 'export let x = 1;',
      '/src/blaze-bin/p/sd2.ts': `import {x} from "./sd1";
          export let y = x;`,
      '/src/p/sd3.ts': `import {y} from "./sd2";
          import {x} from "./sd1";
          export let z = x + y;`,
    });
    const diags =
        checkModuleDeps(p, ['/src/p/sd3.ts'], ['/src/blaze-bin/p/sd2.ts'], '/src');
    expect(diags.length).toBe(1);
    expect(diags[0].messageText)
        .toMatch(/dependency on blaze-bin\/p\/sd1.ts not allowed/);
  });

  it('supports .d.ts files', () => {
    const p = createProgram({
      '/src/blaze-bin/p/sd1.d.ts': 'export declare let x: number;',
      '/src/blaze-bin/p/sd2.d.ts': `import {x} from "./sd1";
          export declare let y: number;`,
      '/src/p/sd3.ts': `import {y} from "./sd2";
          import {x} from "./sd1";
          export let z = x + y;`,
    });
    const diags =
        checkModuleDeps(p, ['/src/p/sd3.ts'], ['/src/blaze-bin/p/sd2.d.ts'], '/src');
    expect(diags.length).toBe(1);
    expect(diags[0].messageText)
        .toMatch(/dependency on blaze-bin\/p\/sd1.d.ts not allowed/);
  });
});
