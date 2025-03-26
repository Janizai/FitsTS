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

describe('FitsHDU getData()', () => {

  it('should return undefined if no data is set', () => {
    const hdu = new FitsHDU(true);
    expect(hdu.getData()).to.be.undefined;
  });

  it('should return a flat array for 1D data', () => {
    const hdu = new FitsHDU(true);
    // Set header for 1D data.
    hdu.header.set('NAXIS', 1, '1D data');
    hdu.header.set('NAXIS1', 5, 'length');
    // Assign a flat typed array.
    hdu.data = new Int32Array([10, 20, 30, 40, 50]);
    const data = hdu.getData();
    // Expect a flat array with same values.
    expect(data).to.deep.equal([10, 20, 30, 40, 50]);
  });

  it('should return a 2D array for 2D data', () => {
    const hdu = new FitsHDU(true);
    // Set header for 2D data. Convention: NAXIS1 = number of columns, NAXIS2 = number of rows.
    hdu.header.set('NAXIS', 2, '2D data');
    hdu.header.set('NAXIS1', 3, 'columns');
    hdu.header.set('NAXIS2', 2, 'rows');
    // Provide a flat typed array of length 6.
    hdu.data = new Int16Array([1, 2, 3, 4, 5, 6]);
    const data = hdu.getData();
    // Expected shape: 2 rows x 3 columns => [[1,2,3], [4,5,6]]
    expect(data).to.deep.equal([[1, 2, 3], [4, 5, 6]]);
  });

  it('should return a flat array for ND (N > 2) data', () => {
    const hdu = new FitsHDU(true);
    // Set header for 3D data.
    hdu.header.set('NAXIS', 3, '3D data');
    hdu.header.set('NAXIS1', 2, 'dim1');
    hdu.header.set('NAXIS2', 2, 'dim2');
    hdu.header.set('NAXIS3', 2, 'dim3');
    // Total elements: 2*2*2 = 8.
    hdu.data = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
    const data = hdu.getData();
    const expected = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    expect(data).to.be.an('array').with.lengthOf(8);
    for (let i = 0; i < expected.length; i++) {
      expect((data as number[])[i]).to.be.closeTo(expected[i], 1e-6);
    }
  });
});