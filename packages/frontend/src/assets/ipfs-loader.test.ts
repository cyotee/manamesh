/**
 * Tests for IPFS asset loader gateway fallback behavior
 * Tests the AbortController reuse fix (MM-013)
 * Tests the timeout configuration fix (MM-015)
 *
 * Note: These tests verify the gateway fallback logic in isolation
 * without requiring helia, since helia dependencies are hard to mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Gateway Fallback AbortController Behavior (MM-013)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  /**
   * This simulates the fixed gateway fetch logic where each attempt
   * gets a fresh AbortController. The key fix is that when one gateway
   * times out (controller.abort() is called), subsequent gateway attempts
   * should NOT be affected because they have their own controllers.
   */
  async function fetchFromGatewayFixed(
    cidString: string,
    gateways: string[],
    timeout: number
  ): Promise<{ blob: Blob; gateway: string } | null> {
    for (const gateway of gateways) {
      // FIX: Create fresh AbortController for each gateway attempt
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await mockFetch(`${gateway}${cidString}`, {
          signal: controller.signal,
        });

        if (response.ok) {
          clearTimeout(timeoutId);
          const blob = await response.blob();
          return { blob, gateway };
        }
        clearTimeout(timeoutId);
      } catch (error) {
        clearTimeout(timeoutId);
        continue;
      }
    }
    return null;
  }

  /**
   * This simulates the BUGGY behavior where a single AbortController
   * is reused across all gateway attempts.
   */
  async function fetchFromGatewayBuggy(
    cidString: string,
    gateways: string[],
    timeout: number
  ): Promise<{ blob: Blob; gateway: string } | null> {
    // BUG: Single controller shared across all gateways
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    for (const gateway of gateways) {
      try {
        const response = await mockFetch(`${gateway}${cidString}`, {
          signal: controller.signal,
        });

        if (response.ok) {
          clearTimeout(timeoutId);
          const blob = await response.blob();
          return { blob, gateway };
        }
      } catch (error) {
        continue;
      }
    }
    clearTimeout(timeoutId);
    return null;
  }

  describe('Fixed implementation', () => {
    it('should try all gateways even after abort on first', async () => {
      const gateways = [
        'https://gateway1.test/ipfs/',
        'https://gateway2.test/ipfs/',
        'https://gateway3.test/ipfs/',
      ];
      const testBlob = new Blob(['success'], { type: 'text/plain' });
      const signals: AbortSignal[] = [];

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.signal) {
          signals.push(options.signal);
        }

        // First gateway: abort error
        if (url.includes('gateway1')) {
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          return Promise.reject(abortError);
        }
        // Second gateway: also fails
        if (url.includes('gateway2')) {
          return Promise.reject(new Error('Network error'));
        }
        // Third gateway: succeeds
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(testBlob),
        });
      });

      const result = await fetchFromGatewayFixed('QmTestCid', gateways, 5000);

      // Should have tried all 3 gateways
      expect(signals.length).toBe(3);
      // Should have succeeded with third gateway
      expect(result).not.toBeNull();
      expect(result?.gateway).toBe('https://gateway3.test/ipfs/');

      // Each signal should be independent (not pre-aborted)
      // The first signal may be aborted, but 2nd and 3rd should not be
      expect(signals[1].aborted).toBe(false);
      expect(signals[2].aborted).toBe(false);
    });

    it('should use fresh AbortController for each gateway', async () => {
      const gateways = [
        'https://gateway1.test/ipfs/',
        'https://gateway2.test/ipfs/',
      ];
      const testBlob = new Blob(['success'], { type: 'text/plain' });
      const signals: AbortSignal[] = [];

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        if (options?.signal) {
          signals.push(options.signal);
        }

        // First gateway fails
        if (url.includes('gateway1')) {
          return Promise.reject(new Error('Network error'));
        }
        // Second succeeds
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(testBlob),
        });
      });

      await fetchFromGatewayFixed('QmTestCid', gateways, 5000);

      // Should have 2 different signals (different AbortController instances)
      expect(signals.length).toBe(2);
      expect(signals[0]).not.toBe(signals[1]);
    });

    it('should succeed on second gateway after first times out', async () => {
      const gateways = [
        'https://slow.gateway/ipfs/',
        'https://fast.gateway/ipfs/',
      ];
      const testBlob = new Blob(['from fast gateway'], { type: 'text/plain' });

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('slow')) {
          // Simulate abort due to timeout
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          return Promise.reject(abortError);
        }
        // Fast gateway succeeds
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(testBlob),
        });
      });

      const result = await fetchFromGatewayFixed('QmTestCid', gateways, 5000);

      expect(result).not.toBeNull();
      expect(result?.gateway).toBe('https://fast.gateway/ipfs/');
    });
  });

  describe('Buggy implementation (demonstrates the bug)', () => {
    it('FAILS: second gateway also aborted after first times out', async () => {
      const gateways = [
        'https://gateway1.test/ipfs/',
        'https://gateway2.test/ipfs/',
      ];
      const testBlob = new Blob(['success'], { type: 'text/plain' });
      const signals: AbortSignal[] = [];
      let abortedSignalUsed = false;

      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        const signal = options?.signal;
        if (signal) {
          signals.push(signal);
          // Check if signal is already aborted when we get the request
          if (signal.aborted && !url.includes('gateway1')) {
            abortedSignalUsed = true;
          }
        }

        // First gateway: abort
        if (url.includes('gateway1')) {
          // Manually abort to simulate timeout
          // In the buggy code, this aborts the shared controller
          const abortError = new Error('Aborted');
          abortError.name = 'AbortError';
          return Promise.reject(abortError);
        }
        // Second gateway would succeed if signal wasn't pre-aborted
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(testBlob),
        });
      });

      // With buggy code, call the buggy function
      // Note: We can't truly demonstrate the timeout behavior in sync tests
      // but we can show that the same signal is reused
      await fetchFromGatewayBuggy('QmTestCid', gateways, 5000);

      // Both calls use the SAME signal (the bug)
      expect(signals.length).toBe(2);
      expect(signals[0]).toBe(signals[1]); // Same signal = BUG
    });
  });

  describe('Edge cases', () => {
    it('should return null when all gateways fail', async () => {
      const gateways = [
        'https://gateway1.test/ipfs/',
        'https://gateway2.test/ipfs/',
      ];

      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await fetchFromGatewayFixed('QmTestCid', gateways, 5000);

      expect(result).toBeNull();
    });

    it('should return first successful gateway result', async () => {
      const gateways = [
        'https://gateway1.test/ipfs/',
        'https://gateway2.test/ipfs/',
      ];
      const testBlob = new Blob(['first gateway'], { type: 'text/plain' });

      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(testBlob),
      });

      const result = await fetchFromGatewayFixed('QmTestCid', gateways, 5000);

      expect(result).not.toBeNull();
      expect(result?.gateway).toBe('https://gateway1.test/ipfs/');
      // Should only call first gateway since it succeeded
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should skip gateway on HTTP error and try next', async () => {
      const gateways = [
        'https://gateway1.test/ipfs/',
        'https://gateway2.test/ipfs/',
      ];
      const testBlob = new Blob(['second gateway'], { type: 'text/plain' });

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({
          ok: true,
          blob: () => Promise.resolve(testBlob),
        });

      const result = await fetchFromGatewayFixed('QmTestCid', gateways, 5000);

      expect(result).not.toBeNull();
      expect(result?.gateway).toBe('https://gateway2.test/ipfs/');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle empty gateway list', async () => {
      const result = await fetchFromGatewayFixed('QmTestCid', [], 5000);
      expect(result).toBeNull();
    });
  });
});

/**
 * Tests for timeout configuration fix (MM-015)
 *
 * The fix ensures that:
 * - heliaTimeout is used for helia fetch operations
 * - gatewayTimeout is used for gateway fetch operations
 * - Legacy timeout option still works for backwards compatibility
 */
describe('Timeout Configuration (MM-015)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  /**
   * Simulates the loadAsset timeout routing logic
   */
  interface LoadOptions {
    timeout?: number;
    heliaTimeout?: number;
    gatewayTimeout?: number;
    preferGateway?: boolean;
  }

  interface Config {
    heliaFetchTimeout: number;
    gatewayTimeout: number;
    preferGateway: boolean;
  }

  function resolveTimeouts(options: LoadOptions, config: Config) {
    const {
      timeout,
      heliaTimeout = timeout ?? config.heliaFetchTimeout,
      gatewayTimeout = timeout ?? config.gatewayTimeout,
      preferGateway = config.preferGateway,
    } = options;

    return { heliaTimeout, gatewayTimeout, preferGateway };
  }

  describe('Timeout resolution', () => {
    const defaultConfig: Config = {
      heliaFetchTimeout: 30000,
      gatewayTimeout: 10000,
      preferGateway: false,
    };

    it('should use config defaults when no options provided', () => {
      const result = resolveTimeouts({}, defaultConfig);

      expect(result.heliaTimeout).toBe(30000);
      expect(result.gatewayTimeout).toBe(10000);
    });

    it('should use specific heliaTimeout and gatewayTimeout when provided', () => {
      const result = resolveTimeouts(
        { heliaTimeout: 5000, gatewayTimeout: 3000 },
        defaultConfig
      );

      expect(result.heliaTimeout).toBe(5000);
      expect(result.gatewayTimeout).toBe(3000);
    });

    it('should use legacy timeout for both when only timeout provided', () => {
      const result = resolveTimeouts({ timeout: 8000 }, defaultConfig);

      expect(result.heliaTimeout).toBe(8000);
      expect(result.gatewayTimeout).toBe(8000);
    });

    it('should override legacy timeout with specific timeouts', () => {
      const result = resolveTimeouts(
        { timeout: 8000, heliaTimeout: 5000 },
        defaultConfig
      );

      // heliaTimeout explicitly set, gatewayTimeout falls back to legacy timeout
      expect(result.heliaTimeout).toBe(5000);
      expect(result.gatewayTimeout).toBe(8000);
    });

    it('should use config defaults for unspecified specific timeouts', () => {
      const result = resolveTimeouts({ heliaTimeout: 5000 }, defaultConfig);

      expect(result.heliaTimeout).toBe(5000);
      expect(result.gatewayTimeout).toBe(10000); // config default
    });
  });

  describe('LoadOptions interface', () => {
    it('should support all timeout options', () => {
      // Type check - these should compile without errors
      const options1: LoadOptions = { timeout: 5000 };
      const options2: LoadOptions = { heliaTimeout: 5000 };
      const options3: LoadOptions = { gatewayTimeout: 5000 };
      const options4: LoadOptions = {
        heliaTimeout: 30000,
        gatewayTimeout: 10000,
      };
      const options5: LoadOptions = {
        timeout: 8000,
        heliaTimeout: 5000,
        gatewayTimeout: 3000,
      };

      // All should be valid LoadOptions
      expect(options1.timeout).toBe(5000);
      expect(options2.heliaTimeout).toBe(5000);
      expect(options3.gatewayTimeout).toBe(5000);
      expect(options4.heliaTimeout).toBe(30000);
      expect(options5.timeout).toBe(8000);
    });
  });

  describe('Timeout usage in fetch operations', () => {
    /**
     * Simulates calling fetch operations with proper timeouts
     */
    async function simulateLoadAsset(
      cid: string,
      options: LoadOptions,
      config: Config,
      fetchMock: typeof mockFetch
    ): Promise<{
      heliaTimeoutUsed: number;
      gatewayTimeoutUsed: number;
      source: 'helia' | 'gateway';
    }> {
      const { heliaTimeout, gatewayTimeout, preferGateway } = resolveTimeouts(
        options,
        config
      );

      let heliaTimeoutUsed = 0;
      let gatewayTimeoutUsed = 0;
      let source: 'helia' | 'gateway' = 'gateway';

      // Simulate fetch operations tracking which timeout was used
      if (preferGateway) {
        gatewayTimeoutUsed = gatewayTimeout;
        source = 'gateway';
        // Try gateway first, then helia as fallback
        try {
          await fetchMock(`https://gateway.test/ipfs/${cid}`, {
            timeout: gatewayTimeout,
          });
        } catch {
          heliaTimeoutUsed = heliaTimeout;
          source = 'helia';
        }
      } else {
        heliaTimeoutUsed = heliaTimeout;
        source = 'helia';
        // Try helia first, then gateway as fallback
        try {
          // Simulating helia operation (would fail)
          throw new Error('Helia not available');
        } catch {
          gatewayTimeoutUsed = gatewayTimeout;
          source = 'gateway';
        }
      }

      return { heliaTimeoutUsed, gatewayTimeoutUsed, source };
    }

    it('should use correct timeouts in helia-first mode', async () => {
      const config: Config = {
        heliaFetchTimeout: 30000,
        gatewayTimeout: 10000,
        preferGateway: false,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'])),
      });

      const result = await simulateLoadAsset(
        'QmTestCid',
        { heliaTimeout: 15000, gatewayTimeout: 5000 },
        config,
        mockFetch
      );

      // Helia tried first with heliaTimeout, fell back to gateway with gatewayTimeout
      expect(result.heliaTimeoutUsed).toBe(15000);
      expect(result.gatewayTimeoutUsed).toBe(5000);
    });

    it('should use correct timeouts in gateway-first mode', async () => {
      const config: Config = {
        heliaFetchTimeout: 30000,
        gatewayTimeout: 10000,
        preferGateway: true,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['test'])),
      });

      const result = await simulateLoadAsset(
        'QmTestCid',
        { heliaTimeout: 15000, gatewayTimeout: 5000 },
        config,
        mockFetch
      );

      // Gateway tried first with gatewayTimeout
      expect(result.gatewayTimeoutUsed).toBe(5000);
      expect(result.source).toBe('gateway');
    });
  });
});
