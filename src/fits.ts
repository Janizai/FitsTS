import * as fs from 'fs';
import { FitsError } from './errors';
import { FitsHDU } from './fitsHDU';
import { FitsHeader } from './fitsHeader';
import { decompress } from './utils';

// Define a union type for supported typed arrays
export type FitsTypedArray =
  | Uint8Array
  | Int16Array
  | Int32Array
  | BigInt64Array
  | Float32Array
  | Float64Array;

export class Fits {
  hdus: FitsHDU[] = [];
  get primary(): FitsHDU {
    return this.hdus[0];
  }

  static readonly logLevel: 'none' | 'error' | 'warn' | 'info' | 'debug' = 'info';

  // Logging helper
  private static log(
    level: 'error' | 'warn' | 'info' | 'debug',
    message: string,
    ...args: any[]
  ): void {
    const levels = { none: 0, error: 1, warn: 2, info: 3, debug: 4 };
    
    if (levels[level] <= levels[Fits.logLevel]) {
      const prefix = `[FitsTS:${level.toUpperCase()}]`;
      
      if (level === 'error') console.error(prefix, message, ...args);
      else if (level === 'warn') console.warn(prefix, message, ...args);
      else if (level === 'info') console.info(prefix, message, ...args);
      else if (level === 'debug') console.debug(prefix, message, ...args);
    }
  }

  // Open a FITS file asynchronously
  static async open(path: string): Promise<Fits> {
    Fits.log('info', `Opening FITS file: ${path}`);
    
    try {
      let data = await fs.promises.readFile(path);

      if (path.endsWith('.gz')) {
        const BlobConstructor = (global as any).Blob || require('buffer').Blob;
        const fileBlob = new BlobConstructor([data]);
        
        const decompressedBlob = await decompress(fileBlob);
        
        const arrayBuffer = await decompressedBlob.arrayBuffer();
        data = Buffer.from(arrayBuffer);
      }

      return Fits.fromArrayBuffer(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      );

    } catch (err: any) {
      Fits.log('error', `Failed to open file: ${err.message}`);
      throw new FitsError(`Failed to read FITS file '${path}': ${err.message}`);
    }
  }

  // Open a FITS file synchronously
  static openSync(path: string): Fits {
    Fits.log('info', `Opening FITS file (sync): ${path}`);
    
    try {
      const data = fs.readFileSync(path);
      return Fits.fromArrayBuffer(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      );

    } catch (err: any) {
      Fits.log('error', `Failed to open file: ${err.message}`);
      throw new FitsError(`Failed to read FITS file '${path}': ${err.message}`);
    }
  }

  // Parse a FITS file from an ArrayBuffer
  static fromArrayBuffer(buffer: ArrayBuffer): Fits {
    const fits = new Fits();
    const dataView = new DataView(buffer);
    
    let offset = 0;
    let isPrimary = true;

    while (offset < buffer.byteLength) {
      const { header, headerBytes, dataBytes, extType } = Fits.parseHeader(
        dataView,
        offset
      );

      const hdu = new FitsHDU(isPrimary);
      hdu.header = header;

      if (extType) hdu.extType = extType;

      fits.hdus.push(hdu);
      offset += headerBytes;

      if (dataBytes > 0) {
        Fits.log(
          'debug',
          `Reading data block (${dataBytes} bytes) for HDU #${fits.hdus.length}`
        );
        hdu.data = Fits.readTypedArray(dataView, offset, dataBytes, header.get('BITPIX'));
      }

      const dataBlockSize = Math.ceil(dataBytes / 2880) * 2880;
      offset += dataBlockSize;
      isPrimary = false;

      if (offset >= buffer.byteLength) break;
    }

    Fits.log('info', `Successfully read FITS file with ${fits.hdus.length} HDU(s).`);
    return fits;
  }

  // Create a new FITS file from scratch
  static create(shape: number[], bitpix: number | string): Fits {
    const typeMap: { [key: string]: number } = {
      uint8: 8,
      int16: 16,
      int32: 32,
      int64: 64,
      float32: -32,
      float64: -64,
    };

    const bitpixValue =
      typeof bitpix === 'string' ? typeMap[bitpix] ?? 0 : bitpix;

    if (![8, 16, 32, 64, -32, -64].includes(bitpixValue)) {
      throw new FitsError(`Unsupported data type for new FITS: ${bitpix}`);
    }

    const fits = new Fits();
    const primaryHDU = new FitsHDU(true);
    const header = primaryHDU.header;
    
    header.set('SIMPLE', true, 'file conforms to FITS standard');
    header.set('BITPIX', bitpixValue, 'bits per data value');
    header.set('NAXIS', shape.length, 'number of data axes');
    
    shape.forEach((len, i) =>
      header.set(`NAXIS${i + 1}`, len, `length of data axis ${i + 1}`)
    );
    
    if (shape.length === 0) {
      header.set('NAXIS', 0, 'no data present');
    }
    
    header.set('EXTEND', true, 'there are extensions');
    const numElements = shape.reduce((prod, n) => prod * n, 1) || 0;

    // Use a mapping to create the appropriate typed array
    const constructorMapping: Record<number, () => FitsTypedArray> = {
      8: () => new Uint8Array(numElements),
      16: () => new Int16Array(numElements),
      32: () => new Int32Array(numElements),
      64: () => new BigInt64Array(numElements),
      [-32]: () => new Float32Array(numElements),
      [-64]: () => new Float64Array(numElements),
    };
    const creator = constructorMapping[bitpixValue];
    if (!creator) {
      throw new FitsError(`Unsupported BITPIX ${bitpixValue} for new FITS creation.`);
    }
    
    primaryHDU.data = creator();
    fits.hdus.push(primaryHDU);
    
    Fits.log(
      'info',
      `Created new FITS with shape [${shape.join(',')}] and BITPIX=${bitpixValue}.`
    );
    return fits;
  }

  // Add an extension HDU
  addHDU(hdu: FitsHDU): void {
    if (this.hdus.length === 0) {
      throw new FitsError('Primary HDU is not defined. Cannot add extension.');
    }

    if (this.hdus.length === 1) {
      this.primary.header.set('EXTEND', true, 'File has extensions');
    }
    
    this.hdus.push(hdu);
    Fits.log('info', `Added extension HDU (total HDUs now ${this.hdus.length}).`);
  }

  // Save the FITS file asynchronously
  async save(path: string): Promise<void> {
    Fits.log('info', `Saving FITS file to: ${path}`);
    const buffer = this.toArrayBuffer();
    
    try {
      await fs.promises.writeFile(path, Buffer.from(buffer));
      Fits.log('info', `File saved successfully: ${path}`);
    
    } catch (err: any) {
      Fits.log('error', `Failed to save file: ${err.message}`);
      throw new FitsError(`Failed to write FITS file '${path}': ${err.message}`);
    }
  }

  // Save the FITS file synchronously
  saveSync(path: string): void {
    Fits.log('info', `Saving FITS file to: ${path} (sync)`);
    const buffer = this.toArrayBuffer();
    
    try {
      fs.writeFileSync(path, Buffer.from(buffer));
      Fits.log('info', `File saved successfully: ${path}`);
    
    } catch (err: any) {
      Fits.log('error', `Failed to save file: ${err.message}`);
      throw new FitsError(`Failed to write FITS file '${path}': ${err.message}`);
    }
  }

  // Convert the FITS file to an ArrayBuffer
  toArrayBuffer(): ArrayBuffer {
    // Update header dimensions if necessary.
    for (const hdu of this.hdus) {
      const header = hdu.header;
      const naxis: number = header.get('NAXIS') ?? 0;
      
      if (!hdu.data || naxis === 0) {
        continue;
      }

      const totalElements = hdu.data.length;
      const currentShape = hdu.getShape();
      const product = currentShape.reduce((p, n) => p * n, 1);
    
      if (product !== totalElements && naxis === 1) {
        header.set('NAXIS1', totalElements);
    
      } else {
        Fits.log(
          'warn',
          'Data length does not match header dimensions; header not automatically adjusted.'
        );
      }
    }

    let totalBytes = 0;
    const headerRecordsArray: string[][] = [];
    const dataBlocks: { array?: FitsTypedArray; byteLength: number; bitpix: number }[] = [];

    // Compute total size and collect header records/data blocks
    this.hdus.forEach((hdu, index) => {
      const records = hdu.header.toRecords();
      const headerBytes = records.length * 80;
      
      headerRecordsArray.push(records);
      totalBytes += headerBytes;
      
      let dataBytes = hdu.data ? hdu.data.byteLength : 0;
      const paddedDataBytes = Math.ceil(dataBytes / 2880) * 2880;
      totalBytes += paddedDataBytes;
      
      dataBlocks.push({ array: hdu.data, byteLength: dataBytes, bitpix: hdu.header.get('BITPIX') });
      
      Fits.log(
        'debug',
        `HDU ${index}: headerBytes=${headerBytes}, dataBytes=${dataBytes}, padded=${paddedDataBytes}`
      );
    });

    const buffer = new ArrayBuffer(totalBytes);
    const view = new DataView(buffer);
    let offset = 0;

    // Write header blocks
    for (const records of headerRecordsArray) {
      offset = Fits.writeHeaderRecords(view, offset, records);
    }

    // Write data blocks using the helper mapping
    for (const block of dataBlocks) {
      const { array: dataArray, byteLength: dataBytes, bitpix } = block;
      
      if (dataArray && dataBytes > 0) {
        offset = Fits.writeTypedArray(view, offset, dataArray, bitpix);
        const padBytes = (2880 - (dataBytes % 2880)) % 2880;
        offset += padBytes;
      }
    }
    return buffer;
  }

  // --- Helper Functions ---

  // Write header records (each 80 characters) to the DataView.
  private static writeHeaderRecords(view: DataView, offset: number, records: string[]): number {
    for (const rec of records) {
      for (let j = 0; j < 80; j++) {
        view.setUint8(offset++, rec.charCodeAt(j));
      }
    }
    return offset;
  }

  // Write a typed array to the DataView using a mapping.
  private static writeTypedArray(
    view: DataView,
    offset: number,
    dataArray: FitsTypedArray,
    bitpix: number
  ): number {
    const mapping: Record<number, { setter: (view: DataView, offset: number, value: any) => void; byteSize: number }> = {
      8: { setter: (v, o, val) => v.setUint8(o, val), byteSize: 1 },
      16: { setter: (v, o, val) => v.setInt16(o, val, false), byteSize: 2 },
      32: { setter: (v, o, val) => v.setInt32(o, val, false), byteSize: 4 },
      64: { setter: (v, o, val) => v.setBigInt64(o, val, false), byteSize: 8 },
      [-32]: { setter: (v, o, val) => v.setFloat32(o, val, false), byteSize: 4 },
      [-64]: { setter: (v, o, val) => v.setFloat64(o, val, false), byteSize: 8 },
    };

    const m = mapping[bitpix];
    if (!m) {
      throw new FitsError(`Unsupported BITPIX ${bitpix} encountered during write.`);
    }
    // For BITPIX 8, ensure the array is a Uint8Array.
    const typedArray =
      bitpix === 8 && !(dataArray instanceof Uint8Array)
        ? new Uint8Array(dataArray.buffer, dataArray.byteOffset, dataArray.byteLength)
        : dataArray;
    
    for (const arr of typedArray) {
      m.setter(view, offset, arr);
      offset += m.byteSize;
    }
    return offset;
  }

  // Read a typed array from the DataView using a mapping.
  private static readTypedArray(
    dataView: DataView,
    offset: number,
    dataBytes: number,
    bitpix: number
  ): FitsTypedArray {
    const mapping: Record<number, { getter: (dv: DataView, offset: number) => any; byteSize: number }> = {
      8: { getter: (dv, o) => dv.getUint8(o), byteSize: 1 },
      16: { getter: (dv, o) => dv.getInt16(o, false), byteSize: 2 },
      32: { getter: (dv, o) => dv.getInt32(o, false), byteSize: 4 },
      64: { getter: (dv, o) => dv.getBigInt64(o, false), byteSize: 8 },
      [-32]: { getter: (dv, o) => dv.getFloat32(o, false), byteSize: 4 },
      [-64]: { getter: (dv, o) => dv.getFloat64(o, false), byteSize: 8 },
    };
    const m = mapping[bitpix];
    if (!m) {
      throw new FitsError(`Unsupported BITPIX ${bitpix} in data unit.`);
    }
    const numElements = dataBytes / m.byteSize;

    let array: FitsTypedArray;    
    switch (bitpix) {
      case 8:
        array = new Uint8Array(numElements);
        break;
      case 16:
        array = new Int16Array(numElements);
        break;
      case 32:
        array = new Int32Array(numElements);
        break;
      case 64:
        array = new BigInt64Array(numElements);
        break;
      case -32:
        array = new Float32Array(numElements);
        break;
      case -64:
        array = new Float64Array(numElements);
        break;
      default:
        throw new FitsError(`Unsupported BITPIX ${bitpix} in data unit.`);
    }

    for (let i = 0; i < numElements; i++) {
      (array as any)[i] = m.getter(dataView, offset);
      offset += m.byteSize;
    }

    return array;
  }

  // Read an 80-character card from the DataView.
  private static readCard(
    dataView: DataView,
    offset: number
  ): { card: string; newOffset: number } {
    let card = '';
    
    for (let i = 0; i < 80; i++) {
      if (offset + i >= dataView.byteLength) {
        throw new FitsError('Unexpected end of file while reading header.');
      }
      card += String.fromCharCode(dataView.getUint8(offset + i));
    }
    
    return { card, newOffset: offset + 80 };
  }

  // Parse a header card into key, value string, and optional comment.
  private static parseCard(
    card: string
  ): { key: string; valueStr: string; comment?: string } {
    const key = card.substring(0, 8).trim();
    const rawValue = card.substring(8).trimEnd();
    
    if (key === 'COMMENT' || key === 'HISTORY') {
      return { key, valueStr: rawValue, comment: rawValue };
    }
    
    let valueStr = '';
    let comment: string | undefined;
    const eqPos = card.indexOf('=');
    
    if (eqPos >= 0) {
      const valueAndComment = card.substring(eqPos + 1).trim();
      const slashIndex = valueAndComment.indexOf('/');
    
        if (slashIndex >= 0) {
            valueStr = valueAndComment.substring(0, slashIndex).trim();
            comment = valueAndComment.substring(slashIndex + 1).trim();
    
        } else {
        valueStr = valueAndComment.trim();
        }
    } else {
      valueStr = rawValue.trim();
    }
    return { key, valueStr, comment };
  }

  // Parse a FITS header starting at the given offset.
  private static parseHeader(
    dataView: DataView,
    startOffset: number
  ): { header: FitsHeader; headerBytes: number; dataBytes: number; extType?: string } {
    const header = new FitsHeader();
    let offset = startOffset;

    let recordCount = 0;
    let extType: string | undefined = undefined;

    // Loop: read an 80-character card until the END keyword is encountered.
    while (true) {
        const { card, newOffset } = Fits.readCard(dataView, offset);
        offset = newOffset;
        recordCount++;

        const { key, valueStr, comment } = Fits.parseCard(card);

        if (key === 'END') break; // Terminate on END card.

        if (!key) continue; // Skip blank cards.

        if (key === 'COMMENT') {
        header.addComment(comment ?? '');
        continue;
        }

        if (key === 'HISTORY') {
        header.addHistory(comment ?? '');
        continue;
        }

        // Interpret value.
        let value: any;
        if (valueStr === '') {
            value = undefined;

        } else if (valueStr.startsWith(`'`)) {
            const endQuoteIndex = valueStr.lastIndexOf(`'`);
            let strVal = endQuoteIndex > 0 ? valueStr.substring(1, endQuoteIndex) : valueStr.substring(1);
            value = strVal.replace(/''/g, `'`);

        } else if (valueStr === 'T' || valueStr === 'F') {
            value = valueStr === 'T';

        } else {
            const numStr = valueStr.replace('D', 'E');
            value = /[.Ee]/.exec(numStr) ? parseFloat(numStr) : parseInt(numStr, 10);
        }

        header.set(key, value, comment);
        if (key === 'XTENSION') {
            extType = typeof value === 'string' ? value.replace(/'/g, '') : `${value}`;
        }
    }

    // Compute total header size (padded to 2880 bytes).
    const headerBytes = Math.ceil(recordCount / 36) * 2880;

    // Validate header start keywords.
    const firstKey = header.keys()[0];
    if (startOffset === 0 && firstKey !== 'SIMPLE') {
      throw new FitsError('Invalid FITS file: primary HDU missing SIMPLE keyword.');
    
    } else if (startOffset !== 0 && firstKey !== 'XTENSION') {
      throw new FitsError('Invalid FITS file: extension HDU missing XTENSION keyword.');
    
    }
    
    if (startOffset !== 0) {
      header.set('EXTEND', true);
    }

    // Compute expected dataBytes based on BITPIX, NAXIS, etc.
    const bitpix: number = header.get('BITPIX');
    const naxis: number = header.get('NAXIS') ?? 0;
    const pcount: number = header.get('PCOUNT') ?? 0;
    const gcount: number = header.get('GCOUNT') ?? 1;
    
    let dataBytes = 0;
    
    if (naxis > 0) {
      let naxisProduct = 1;
      for (let i = 1; i <= naxis; i++) {
        naxisProduct *= header.get(`NAXIS${i}`) ?? 1;
      }
      
      const totalBits = Math.abs(bitpix) * gcount * (pcount + naxisProduct);
      dataBytes = totalBits / 8;
    }

    return { header, headerBytes, dataBytes, extType };
  }
}
