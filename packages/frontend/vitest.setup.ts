/**
 * Vitest setup file
 * Polyfills and global setup for test environment
 */

// Polyfill Promise.withResolvers for Node < 22
// This is used by libp2p dependencies
if (typeof Promise.withResolvers !== 'function') {
  // @ts-expect-error Polyfilling Promise.withResolvers
  Promise.withResolvers = function <T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  } {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
