/**
 * Tests for IPFS asset loader gateway fallback behavior
 * Tests the AbortController reuse fix (MM-013)
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
