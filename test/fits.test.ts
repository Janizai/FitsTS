import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as pako from 'pako';
import { expect } from 'chai';
import { Fits } from '../src/fits';
import { FitsError } from '../src/errors';
import { FitsHDU } from '../src/fitsHDU';
import { FitsHeader } from '../src/fitsHeader';

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

  it('should save and read a gzipped FITS file', async () => {
    const shape = [10, 10];
    const fits = Fits.create(shape, 'uint8');
    const tempGzipFile = getTempFilePath('test_fits_gzip.fits.gz');
  
    // Fill the data with a pattern.
    if (fits.primary.data) {
      const data = fits.primary.data as Uint8Array;
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }
    }
  
    // Convert the FITS file to an ArrayBuffer.
    const fitsBuffer = fits.toArrayBuffer();
  
    // Compress the ArrayBuffer using pako.gzip.
    const compressedData = pako.gzip(new Uint8Array(fitsBuffer));
  
    // Write the compressed data to a gz file asynchronously.
    await fs.promises.writeFile(tempGzipFile, Buffer.from(compressedData));
  
    // Read back the gzipped file.
    const gzipBuffer = await fs.promises.readFile(tempGzipFile);
  
    // Decompress the file.
    const decompressedData = pako.ungzip(gzipBuffer);
    // Create a new ArrayBuffer from the decompressed data.
    const decompressedBuffer = decompressedData.buffer.slice(
      decompressedData.byteOffset,
      decompressedData.byteOffset + decompressedData.byteLength
    );
  
    // Create a FITS object from the decompressed ArrayBuffer.
    const fitsFromGzip = Fits.fromArrayBuffer(decompressedBuffer);
    expect(fitsFromGzip.hdus.length).to.be.greaterThan(0);
  
    // Clean up the temporary file.
    fs.unlinkSync(tempGzipFile);
  });

  it('should correctly parse a binary table with provided TTYPE names', () => {
    // Build a header for a binary table with 2 rows and 2 fields.
    const header = new FitsHeader();
    header.set('NAXIS2', 2, 'Number of rows');
    // Row size is 5 bytes (ASCII) + 4 bytes (float32) = 9 bytes per row.
    header.set('NAXIS1', 9, 'Row size');
    header.set('TFIELDS', 2, 'Number of fields');
    header.set('TFORM1', '5A', 'Format for column 1');
    header.set('TTYPE1', 'colText', 'Name for column 1');
    header.set('TFORM2', '1E', 'Format for column 2');
    header.set('TTYPE2', 'colFloat', 'Name for column 2');

    // Create a binary data block with 2 rows.
    const buffer = new ArrayBuffer(9 * 2);
    const view = new DataView(buffer);
    // Row 0: "Hello" and float 1.23.
    const text1 = "Hello";
    for (let i = 0; i < 5; i++) {
      view.setUint8(i, text1.charCodeAt(i));
    }
    view.setFloat32(5, 1.23, false);

    // Row 1: "World" and float 4.56.
    const row1Offset = 9;
    const text2 = "World";
    for (let i = 0; i < 5; i++) {
      view.setUint8(row1Offset + i, text2.charCodeAt(i));
    }
    view.setFloat32(row1Offset + 5, 4.56, false);

    const table = (Fits as any).readBinaryTable(view, 0, buffer.byteLength, header);
    expect(table).to.be.an('array').with.lengthOf(2);
    expect(table[0]).to.have.property('colText', 'Hello');
    expect(table[0]).to.have.property('colFloat');
    expect(table[0].colFloat).to.be.closeTo(1.23, 1e-5);
    expect(table[1]).to.have.property('colText', 'World');
    expect(table[1]).to.have.property('colFloat');
    expect(table[1].colFloat).to.be.closeTo(4.56, 1e-5);
  });

  it('should correctly parse a binary table using default column names when TTYPE is missing', () => {
    // Build a header for a binary table with 1 row and 2 fields.
    const header = new FitsHeader();
    header.set('NAXIS2', 1, 'Number of rows');
    // Row size: 5 bytes for ASCII + 4 bytes for float32 = 9.
    header.set('NAXIS1', 9, 'Row size');
    header.set('TFIELDS', 2, 'Number of fields');
    header.set('TFORM1', '5A', 'Format for column 1');
    // Do not set TTYPE1 so that default name is used.
    header.set('TFORM2', '1E', 'Format for column 2');
    // Do not set TTYPE2.

    // For default naming, we expect the implementation to use "ttype1", "ttype2", etc.
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    // Row: "Alpha" and float 7.89.
    const text = "Alpha";
    for (let i = 0; i < 5; i++) {
      view.setUint8(i, text.charCodeAt(i));
    }
    view.setFloat32(5, 7.89, false);

    const table = (Fits as any).readBinaryTable(view, 0, buffer.byteLength, header);
    expect(table).to.be.an('array').with.lengthOf(1);
    // Expect default column names as "COL1" and "COL2".
    expect(table[0]).to.have.property('COL1', 'Alpha');
    expect(table[0]).to.have.property('COL2');
    expect(table[0].COL2).to.be.closeTo(7.89, 1e-5);
  });

  it('should ignore empty COMMENT and HISTORY header fields', () => {
    const shape = [10, 10];
    const fits = Fits.create(shape, 'uint8');
    fits.primary.header.addComment('');
    fits.primary.header.addHistory('');

    const buffer = fits.toArrayBuffer();
    const fits2 = Fits.fromArrayBuffer(buffer);
    const header = fits2.primary.header;
    expect(header.get('COMMENT')).to.be.undefined;
    expect(header.get('HISTORY')).to.be.undefined;
  });
});
