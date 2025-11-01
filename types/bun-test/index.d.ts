/// <reference types="node" />

declare module "bun:test" {
  type TestFn = (name: string, fn: (...args: any[]) => any | Promise<any>) => void;

  export const describe: TestFn & {
    skip: TestFn;
    only: TestFn;
    todo: (name: string) => void;
  };

  export const test: TestFn & {
    skip: TestFn;
    only: TestFn;
    todo: (name: string) => void;
  };

  export const it: typeof test;

  export const beforeAll: (fn: () => any | Promise<any>) => void;
  export const afterAll: (fn: () => any | Promise<any>) => void;
  export const beforeEach: (fn: () => any | Promise<any>) => void;
  export const afterEach: (fn: () => any | Promise<any>) => void;

  export const expect: any;

  export const vi: {
    fn: (...args: any[]) => any;
    spyOn: (...args: any[]) => any;
    resetAllMocks: () => void;
    clearAllMocks: () => void;
    restoreAllMocks: () => void;
  };
}
