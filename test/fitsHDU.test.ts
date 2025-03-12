// test/fitsHDU.test.ts
import { expect } from 'chai';
import { FitsHDU } from '../src/fitsHDU';
import { FitsHeader } from '../src/fitsHeader';

describe('FitsHDU Class', () => {
  let hdu: FitsHDU;
  let header: FitsHeader;

  beforeEach(() => {
    // Create a new primary HDU instance before each test.
    hdu = new FitsHDU(true);
    header = hdu.header;
  });

  describe('Initialization', () => {
    it('should initialize with a header and isPrimary flag', () => {
      expect(hdu.header).to.be.instanceOf(FitsHeader);
      expect(hdu.isPrimary).to.be.true;
    });
  });

  describe('Header Keyword Access', () => {
    it('should allow setting and getting header keywords directly', () => {
      header.set('OBJECT', 'Test Object', 'object name');
      // Casting header as any to allow direct property access.
      expect((header as any).OBJECT).to.equal('Test Object');
      expect(header.get('OBJECT')).to.equal('Test Object');
    });
  });

  describe('getShape()', () => {
    it('should return an empty array if NAXIS is 0 or undefined', () => {
      header.set('NAXIS', 0, 'no data');
      const shape = hdu.getShape();
      expect(shape).to.be.an('array').that.is.empty;
    });

    it('should return correct dimensions when NAXIS is defined', () => {
      header.set('NAXIS', 2, '2D data');
      header.set('NAXIS1', 100, 'width');
      header.set('NAXIS2', 200, 'height');
      const shape = hdu.getShape();
      expect(shape).to.deep.equal([100, 200]);
    });
  });

  describe('width and height getters', () => {
    it('should return undefined if NAXIS1 or NAXIS2 are not set', () => {
      // Not setting NAXIS1 or NAXIS2 should yield undefined.
      expect(hdu.width).to.be.undefined;
      expect(hdu.height).to.be.undefined;
    });

    it('should return the correct width and height when set', () => {
      header.set('NAXIS1', 256, 'width');
      header.set('NAXIS2', 512, 'height');
      expect(hdu.width).to.equal(256);
      expect(hdu.height).to.equal(512);
    });
  });
});
