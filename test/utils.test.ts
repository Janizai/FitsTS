import { expect } from 'chai';
import { Zscale, getStats, decompress } from '../src/utils';
import pako from 'pako';

describe('Utils Module', () => {
  
  describe('Zscale', () => {
    it('should return [0, 0] for an empty input array', () => {
      const z = new Zscale();
      const limits = z.get_limits([]);
      expect(limits).to.deep.equal([0, 0]);
    });

    it('should compute limits on a sorted array', () => {
      const z = new Zscale();
      const values = Array.from({ length: 100 }, (_, i) => i);
      const limits = z.get_limits(values);
      expect(limits[0]).to.be.at.least(values[0]);
      expect(limits[1]).to.be.at.most(values[values.length - 1]);
    });

    it('should ignore NaN and Infinity values', () => {
      const z = new Zscale();
      const values = [1, 2, 3, NaN, Infinity, -Infinity, 4, 5];
      const limits = z.get_limits(values);
      expect(limits[0]).to.be.at.least(1);
      expect(limits[1]).to.be.at.most(5);
    });
  });

  describe('getStats', () => {
    it('should return empty stats when data is empty', () => {
      const result = getStats([], []);
      expect(result.keys).to.deep.equal([]);
      expect(result.data).to.deep.equal([]);
    });

    it('should compute image stats when keys array is empty', () => {
      const data = [1, 2, 3, 4, 5];
      const result = getStats(data, []);
      expect(result.keys).to.deep.equal(['', 'Image Data']);
      expect(result.data[0][1]).to.equal(1);  // min
      expect(result.data[1][1]).to.equal(5);  // max
      expect(result.data[2][1]).to.be.closeTo(3, 0.001);
    });

    it('should compute table stats when keys are provided', () => {
      const data = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9]
      ];
      const keys = ['A', 'B', 'C'];
      const result = getStats(data, keys);
      expect(result.keys).to.deep.equal(['', 'A', 'B', 'C']);
      expect(result.data[0][1]).to.equal(1);
      expect(result.data[1][1]).to.equal(7);
      expect(result.data[2][1]).to.be.closeTo(4, 0.001);
    });
  });

  describe('decompress', () => {
    // For these tests, we use Node’s Blob if available.
    it('should decompress a compressed Blob correctly', async () => {
      const text = "Hello, FITS! This is a test string for compression.";
      // Compress the string using pako.
      const compressed = pako.deflate(text);
      // Create a Blob from the compressed data.
      const compressedBlob = new Blob([compressed]);
      // Call decompress.
      const decompressedBlob = await decompress(compressedBlob);
      const decompressedText = await decompressedBlob.text();
      expect(decompressedText).to.equal(text);
    });

    it('should return a Blob when decompressing valid compressed data', async () => {
      const text = "Test data for decompress function.";
      const compressed = pako.deflate(text);
      const compressedBlob = new Blob([compressed]);
      const result = await decompress(compressedBlob);
      expect(result).to.be.instanceOf(Blob);
    });
  });
});
