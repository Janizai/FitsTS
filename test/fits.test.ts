import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { expect } from 'chai';
import { Fits } from '../src/fits';
import { FitsError } from '../src/errors';
import { FitsHDU } from '../src/fitsHDU';

describe('Fits Class', () => {
  // --- Helper functions for tests ---

  // Create a minimal header block as an ArrayBuffer.
  function createMinimalHeaderBuffer(): ArrayBuffer {
    const headerCards = [
      "SIMPLE  =                    T / file conforms to FITS standard",
      "BITPIX  =                   16 / bits per data value                ",
      "NAXIS   =                    2 / number of data axes                ",
      "NAXIS1  =                  100 / length of data axis 1              ",
      "NAXIS2  =                  100 / length of data axis 2              ",
      "END"
    ];
    // Each card padded to 80 characters.
    let headerStr = headerCards.map(card => card.padEnd(80, ' ')).join('');

    // Ensure header is padded to a multiple of 36 records (2880 bytes)
    const nCards = Math.ceil(headerStr.length / 80);
    const totalCards = Math.ceil(nCards / 36) * 36;

    headerStr = headerStr.padEnd(totalCards * 80, ' ');

    const buffer = new ArrayBuffer(headerStr.length);
    const view = new DataView(buffer);

    for (let i = 0; i < headerStr.length; i++) {
      view.setUint8(i, headerStr.charCodeAt(i));
    }
    return buffer;
  }

  // Write a temporary file and return its path.
  function getTempFilePath(filename: string): string {
    return path.join(os.tmpdir(), filename);
  }

  // --- Test Cases ---

  it('should create a new FITS file with correct header values and data type', () => {
    const shape = [100, 100];
    const fits = Fits.create(shape, 'int16');
    const header = fits.primary.header;

    expect(header.get('SIMPLE')).to.be.true;
    expect(header.get('BITPIX')).to.equal(16);
    expect(header.get('NAXIS')).to.equal(2);
    expect(header.get('NAXIS1')).to.equal(100);
    expect(header.get('NAXIS2')).to.equal(100);
    expect(fits.primary.data).to.be.instanceOf(Int16Array);
  });

  it('should round-trip toArrayBuffer() and fromArrayBuffer() correctly', () => {
    const shape = [50, 50];
    const fits = Fits.create(shape, 'float32');
    
    // Fill the data with some pattern.
    if (fits.primary.data) {
      const data = fits.primary.data as Float32Array;
      
      for (let i = 0; i < data.length; i++) {
        data[i] = i * 0.1;
      }
    }

    const buffer = fits.toArrayBuffer();
    expect(buffer).to.be.instanceOf(ArrayBuffer);

    const fits2 = Fits.fromArrayBuffer(buffer);
    expect(fits2.hdus.length).to.be.greaterThan(0);

    const header2 = fits2.primary.header;
    expect(header2.get('SIMPLE')).to.be.true;
    // For float32, BITPIX should be -32
    expect(header2.get('BITPIX')).to.equal(-32);
    expect(fits2.primary.data).to.be.instanceOf(Float32Array);

    // Compare a few data values.
    const data1 = fits.primary.data as Float32Array;
    const data2 = fits2.primary.data as Float32Array;
    
    for (let i = 0; i < 10; i++) {
      expect(data2[i]).to.be.closeTo(data1[i], 1e-6);
    }
  });

  it('should correctly parse a minimal header block', () => {
    const buffer = createMinimalHeaderBuffer();
    const dataView = new DataView(buffer);
    
    // Access the private parseHeader via type assertion.
    const { header, headerBytes, dataBytes } = (Fits as any).parseHeader(dataView, 0);
    expect(header.get('SIMPLE')).to.be.true;
    expect(header.get('BITPIX')).to.equal(16);
    expect(header.get('NAXIS')).to.equal(2);
    expect(header.get('NAXIS1')).to.equal(100);
    expect(header.get('NAXIS2')).to.equal(100);
    
    // For a 100x100 16-bit image: 100*100*16/8 = 20000 bytes expected.
    expect(dataBytes).to.equal(20000);
    
    // Header size (headerBytes) must be a multiple of 2880.
    expect(headerBytes % 2880).to.equal(0);
  });

  it('should throw an error if primary header is missing SIMPLE keyword', () => {
    // Create a header without the SIMPLE keyword.
    const headerCards = [
      "BITPIX  =                   16 / bits per data value                ",
      "NAXIS   =                    2 / number of data axes                ",
      "NAXIS1  =                  100 / length of data axis 1              ",
      "NAXIS2  =                  100 / length of data axis 2              ",
      "END"
    ];
    
    let headerStr = headerCards.map(card => card.padEnd(80, ' ')).join('');
    const nCards = Math.ceil(headerStr.length / 80);
    const totalCards = Math.ceil(nCards / 36) * 36;
    
    headerStr = headerStr.padEnd(totalCards * 80, ' ');
    
    const buffer = new ArrayBuffer(headerStr.length);
    const view = new DataView(buffer);
    
    for (let i = 0; i < headerStr.length; i++) {
      view.setUint8(i, headerStr.charCodeAt(i));
    }
    
    expect(() => {
      (Fits as any).parseHeader(view, 0);
    }).to.throw(FitsError, /primary HDU missing SIMPLE keyword/);
  });

  it('should correctly parse a header card using readCard and parseCard helpers', () => {
    const sampleCard = "SIMPLE  =                    T / file conforms to FITS standard";
    
    // Pad sampleCard to 80 characters.
    const paddedCard = sampleCard.padEnd(80, ' ');
    const buffer = new ArrayBuffer(80);
    const view = new DataView(buffer);
    
    for (let i = 0; i < 80; i++) {
      view.setUint8(i, paddedCard.charCodeAt(i));
    }
    
    const { card, newOffset } = (Fits as any).readCard(view, 0);
    expect(card).to.equal(paddedCard);
    expect(newOffset).to.equal(80);

    const { key, valueStr, comment } = (Fits as any).parseCard(card);
    expect(key).to.equal("SIMPLE");
    expect(valueStr).to.contain("T");
    expect(comment).to.contain("FITS standard");
  });

  it('should throw error when addHDU is called without primary HDU', () => {
    const fits = new Fits();
    const hdu = new FitsHDU(false);
    expect(() => fits.addHDU(hdu)).to.throw(FitsError, /Primary HDU is not defined/);
  });

  it('should save and read a FITS file synchronously', () => {
    const shape = [20, 20];
    const fits = Fits.create(shape, 'int32');
    const tempFile = getTempFilePath('test_fits_sync.fits');
    
    // Fill the data with some dummy values.
    if (fits.primary.data) {
      const data = fits.primary.data as Int32Array;
    
      for (let i = 0; i < data.length; i++) {
        data[i] = i;
      }
    }

    // Save synchronously.
    fits.saveSync(tempFile);
    
    // Read the file back.
    const buffer = fs.readFileSync(tempFile).buffer;
    const fits2 = Fits.fromArrayBuffer(buffer);
    expect(fits2.hdus.length).to.be.greaterThan(0);
    
    // Clean up
    fs.unlinkSync(tempFile);
  });

  it('should save and read a FITS file asynchronously', async () => {
    const shape = [10, 10];
    const fits = Fits.create(shape, 'uint8');
    const tempFile = getTempFilePath('test_fits_async.fits');
  
    // Fill the data with a pattern.
    if (fits.primary.data) {
      const data = fits.primary.data as Uint8Array;
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }
    }
  
    // Save asynchronously.
    await fits.save(tempFile);
  
    // Read the file back.
    const fileBuffer = await fs.promises.readFile(tempFile);
    const fits2 = Fits.fromArrayBuffer(fileBuffer.buffer);
    expect(fits2.hdus.length).to.be.greaterThan(0);
  
    // Check that file size is a multiple of 2880.
    expect(fileBuffer.length % 2880).to.equal(0);
  
    // Clean up
    fs.unlinkSync(tempFile);
  });
});
