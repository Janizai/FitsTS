import * as fs from 'fs';
import { FitsError } from './errors';
import { FitsHDU } from './fitsHDU';
import { FitsHeader } from './fitsHeader';
import { decompress } from './utils';

// Define a union type for supported typed arrays (BigInt64 removed)
export type FitsTypedArray =
  | Uint8Array
  | Int16Array
  | Int32Array
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

  // Open a FITS file asynchronously with support for .gz files
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

  // Open a FITS file synchronously (note: no decompression support here)
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
      const { header, headerBytes, dataBytes, extType } = Fits.parseHeader(dataView, offset);
      const hdu = new FitsHDU(isPrimary);
      hdu.header = header;
      if (extType) hdu.extType = extType;
      fits.hdus.push(hdu);
      offset += headerBytes;
      if (dataBytes > 0) {
        Fits.log('debug', `Reading data block (${dataBytes} bytes) for HDU #${fits.hdus.length}`);

        if (extType === 'BINTABLE' || extType === 'TABLE') {
          hdu.data = Fits.readBinaryTable(dataView, offset, dataBytes, header);
        } else {
          hdu.data = Fits.readTypedArray(dataView, offset, dataBytes, header.get('BITPIX'));
        }
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
      float32: -32,
      float64: -64,
    };
    const bitpixValue = typeof bitpix === 'string' ? typeMap[bitpix] ?? 0 : bitpix;
    if (![8, 16, 32, -32, -64].includes(bitpixValue)) {
      throw new FitsError(`Unsupported data type for new FITS: ${bitpix}`);
    }
    const fits = new Fits();
    const primaryHDU = new FitsHDU(true);
    const header = primaryHDU.header;
    header.set('SIMPLE', true, 'file conforms to FITS standard');
    header.set('BITPIX', bitpixValue, 'bits per data value');
    header.set('NAXIS', shape.length, 'number of data axes');
    shape.forEach((len, i) => header.set(`NAXIS${i + 1}`, len, `length of data axis ${i + 1}`));
    if (shape.length === 0) {
      header.set('NAXIS', 0, 'no data present');
    }
    header.set('EXTEND', true, 'there are extensions');
    const numElements = shape.reduce((prod, n) => prod * n, 1) || 0;
    const constructorMapping: Record<number, () => FitsTypedArray> = {
      8: () => new Uint8Array(numElements),
      16: () => new Int16Array(numElements),
      32: () => new Int32Array(numElements),
      [-32]: () => new Float32Array(numElements),
      [-64]: () => new Float64Array(numElements),
    };
    const creator = constructorMapping[bitpixValue];
    if (!creator) {
      throw new FitsError(`Unsupported BITPIX ${bitpixValue} for new FITS creation.`);
    }
    primaryHDU.data = creator();
    fits.hdus.push(primaryHDU);
    Fits.log('info', `Created new FITS with shape [${shape.join(',')}] and BITPIX=${bitpixValue}.`);
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

  toArrayBuffer(): ArrayBuffer {
    // Update header dimensions if necessary.
    for (const hdu of this.hdus) {
      const header = hdu.header;
      const naxis: number = header.get('NAXIS') ?? 0;
      if (!hdu.data || naxis === 0) continue;
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

    this.hdus.forEach((hdu, index) => {
      const records = hdu.header.toRecords();
      const headerBytes = records.length * 80;
      headerRecordsArray.push(records);
      totalBytes += headerBytes;
      let dataArray = hdu.data;
      let dataBytes = 0;
      if (dataArray) {
        if (hdu.extType === 'BINTABLE' || hdu.extType === 'TABLE') {
          // For table HDUs, convert the table (an array of row objects) into a Uint8Array.
          dataArray = Fits.writeBinaryTableData(dataArray as any[], hdu.header);
          dataBytes = dataArray.byteLength;
        } else {
            // For image (typed array) data, scale the data if needed.
            const bscale = hdu.header.get('BSCALE') ?? 1;
            const bzero = hdu.header.get('BZERO') ?? 0;
            const constructor = dataArray.constructor as new (length: number) => any;
            const scaled = new constructor(dataArray.length);
            for (let i = 0; i < dataArray.length; i++) {
                scaled[i] = (dataArray[i] - bzero) / bscale;
            }
            dataArray = scaled;
            dataBytes = (dataArray as Uint8Array).byteLength;
        }
      }
      const paddedDataBytes = Math.ceil(dataBytes / 2880) * 2880;
      totalBytes += paddedDataBytes;
      // Now, dataArray is guaranteed to be a typed array (FitsTypedArray)
      dataBlocks.push({ array: dataArray as FitsTypedArray, byteLength: dataBytes, bitpix: hdu.header.get('BITPIX') });
      Fits.log('debug', `HDU ${index}: headerBytes=${headerBytes}, dataBytes=${dataBytes}, padded=${paddedDataBytes}`);
    });

    const buffer = new ArrayBuffer(totalBytes);
    const view = new DataView(buffer);
    let offset = 0;
    for (const records of headerRecordsArray) {
      offset = Fits.writeHeaderRecords(view, offset, records);
    }
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

  // New helper: serialize table data (an array of row objects) into a Uint8Array.
  private static writeBinaryTableData(table: any[], header: FitsHeader): Uint8Array {
    const nrows = header.get('NAXIS2');
    const rowSize = header.get('NAXIS1');
    const tfields = header.get('TFIELDS');
    const forms: string[] = [];
    for (let i = 1; i <= tfields; i++) {
      const formVal = header.get(`TFORM${i}`);
      if (!formVal) {
        throw new FitsError(`Missing TFORM${i} in BINTABLE header`);
      }
      forms.push(String(formVal).trim().toUpperCase());
    }
    const buffer = new ArrayBuffer(nrows * rowSize);
    const view = new DataView(buffer);
    for (let row = 0; row < nrows; row++) {
      const rowObj = table[row];
      let colOffset = row * rowSize;
      for (let col = 0; col < tfields; col++) {
        const form = forms[col];
        const match = /^(\d*)([AIEFD])/i.exec(form) || /^(\d*)A/i.exec(form);
        if (!match) {
          throw new FitsError(`Unsupported TFORM '${form}' for column ${col + 1}`);
        }
        const repeat = parseInt(match[1] || '1', 10);
        const code = match[2].toUpperCase();
        // Determine column name: use TTYPE if provided, else default to "COL{n}"
        const colName = header.get(`TTYPE${col + 1}`) ? String(header.get(`TTYPE${col + 1}`)).trim() : `COL${col + 1}`;
        const value = rowObj[colName];
        if (code === 'A') {
          let text = String(value || '');
          // Ensure the text is exactly 'repeat' characters
          if (text.length < repeat) {
            text = text.padEnd(repeat, ' ');
          } else if (text.length > repeat) {
            text = text.substring(0, repeat);
          }
          for (let i = 0; i < repeat; i++) {
            view.setUint8(colOffset + i, text.charCodeAt(i));
          }
          colOffset += repeat;
        } else {
          let size: number;
          let setter: (dv: DataView, offset: number, val: number) => void;
          if (code === 'E') { size = 4; setter = (dv, off, val) => dv.setFloat32(off, val, false); }
          else if (code === 'D') { size = 8; setter = (dv, off, val) => dv.setFloat64(off, val, false); }
          else if (code === 'I') { size = 2; setter = (dv, off, val) => dv.setInt16(off, val, false); }
          else {
            throw new FitsError(`TFORM code '${code}' not implemented for writing`);
          }
          if (repeat === 1) {
            const num = Number(value || 0);
            setter(view, colOffset, num);
            colOffset += size;
          } else {
            const arr = Array.isArray(value) ? value : [];
            for (let i = 0; i < repeat; i++) {
                const num = Number(arr[i] || 0);
                setter(view, colOffset, num);
                colOffset += size;
            }
          }
        }
      }
    }
  return new Uint8Array(buffer);
  }

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
  private static writeTypedArray(view: DataView, offset: number, dataArray: FitsTypedArray, bitpix: number): number {
    const mapping: Record<number, { setter: (view: DataView, offset: number, value: any) => void; byteSize: number }> = {
      8: { setter: (v, o, val) => v.setUint8(o, val), byteSize: 1 },
      16: { setter: (v, o, val) => v.setInt16(o, val, false), byteSize: 2 },
      32: { setter: (v, o, val) => v.setInt32(o, val, false), byteSize: 4 },
      [-32]: { setter: (v, o, val) => v.setFloat32(o, val, false), byteSize: 4 },
      [-64]: { setter: (v, o, val) => v.setFloat64(o, val, false), byteSize: 8 },
    };
    const m = mapping[bitpix];
    if (!m) {
      throw new FitsError(`Unsupported BITPIX ${bitpix} encountered during write.`);
    }
    const typedArray =
      bitpix === 8 && !(dataArray instanceof Uint8Array)
        ? new Uint8Array(dataArray.buffer, dataArray.byteOffset, dataArray.byteLength)
        : dataArray;
    for (const item of typedArray) {
      m.setter(view, offset, item);
      offset += m.byteSize;
    }
    return offset;
  }

  // Read a typed array from the DataView using a mapping.
  private static readTypedArray(dataView: DataView, offset: number, dataBytes: number, bitpix: number): FitsTypedArray {
    const mapping: Record<number, { getter: (dv: DataView, offset: number) => any; byteSize: number }> = {
      8: { getter: (dv, o) => dv.getUint8(o), byteSize: 1 },
      16: { getter: (dv, o) => dv.getInt16(o, false), byteSize: 2 },
      32: { getter: (dv, o) => dv.getInt32(o, false), byteSize: 4 },
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

  private static readBinaryTable(
    dataView: DataView,
    startOffset: number,
    dataBytes: number,
    header: FitsHeader
  ): any[] {
    // Number of rows, total row size in bytes, and number of columns (fields)
    const nrows = header.get('NAXIS2');
    const rowSize = header.get('NAXIS1');
    const tfields = header.get('TFIELDS');
  
    // Prepare column metadata: TFORMs and column names (from TTYPE keywords)
    const forms: string[] = [];
    const colNames: string[] = [];
    for (let i = 1; i <= tfields; i++) {
      const formVal = header.get(`TFORM${i}`);
      if (!formVal) {
        throw new FitsError(`Missing TFORM${i} in BINTABLE header`);
      }
      forms.push(String(formVal).trim().toUpperCase());
      // Use TTYPE if available; otherwise fall back to a default column name.
      const ttypeVal = header.get(`TTYPE${i}`);
      colNames.push(ttypeVal ? String(ttypeVal).trim() : `COL${i}`);
    }
  
    // Mapping for numeric types: byte size and DataView getter.
    const numericMapping: { [code: string]: { size: number; getter: (dv: DataView, offset: number) => any } } = {
      'E': { size: 4, getter: (dv, offset) => dv.getFloat32(offset, false) },
      'D': { size: 8, getter: (dv, offset) => dv.getFloat64(offset, false) },
      'I': { size: 2, getter: (dv, offset) => dv.getInt16(offset, false) }
      // Additional numeric types (like J for 32-bit ints) could be added here if needed.
    };
  
    // Read each row into an object whose keys are the column names.
    const table: any[] = [];
    for (let row = 0; row < nrows; row++) {
      const rowOffset = startOffset + row * rowSize;
      let colOffset = 0;
      const rowObj: any = {};
  
      for (let col = 0; col < tfields; col++) {
        const form = forms[col];
        // Parse repeat count and type code (e.g. "10A", "1E", "3D", etc.)
        const match = /^(\d*)([AIEFD])/i.exec(form) || /^(\d*)A/i.exec(form);
        if (!match) {
          throw new FitsError(`Unsupported TFORM '${form}' for column ${col + 1}`);
        }
        const repeat = parseInt(match[1] || '1', 10);
        const code = match[2].toUpperCase();
  
        let value: any;
        if (code === 'A') {
          // For ASCII columns: read 'repeat' bytes and convert to string.
          let text = '';
          for (let i = 0; i < repeat; i++) {
            const byteVal = dataView.getUint8(rowOffset + colOffset + i);
            // Append non-zero bytes (ignore null padding)
            text += byteVal !== 0 ? String.fromCharCode(byteVal) : '';
          }
          value = text.trim();
          colOffset += repeat;
        } else if (numericMapping[code]) {
          const { size, getter } = numericMapping[code];
          if (repeat === 1) {
            value = getter(dataView, rowOffset + colOffset);
            colOffset += size;
          } else {
            const values = new Array(repeat);
            for (let i = 0; i < repeat; i++) {
              values[i] = getter(dataView, rowOffset + colOffset);
              colOffset += size;
            }
            value = values;
          }
        } else {
          throw new FitsError(`TFORM code '${code}' not yet implemented`);
        }
        // Map the value to its corresponding column name.
        rowObj[colNames[col]] = value;
      }
      table.push(rowObj);
    }
  
    return table;
  }

  // Read an 80-character card from the DataView.
  private static readCard(dataView: DataView, offset: number): { card: string; newOffset: number } {
    let card = '';
    for (let i = 0; i < 80; i++) {
      if (offset + i >= dataView.byteLength) {
        throw new FitsError('Unexpected end of file while reading header.');
      }
      card += String.fromCharCode(dataView.getUint8(offset + i));
    }
    return { card, newOffset: offset + 80 };
  }

  // Simplified parseHeader using helper functions.
  private static parseHeader(dataView: DataView, startOffset: number): { header: FitsHeader; headerBytes: number; dataBytes: number; extType?: string } {
    const { cards } = this.readHeaderCards(dataView, startOffset);
    const headerBytes = Math.ceil(cards.length / 36) * 2880;
    const { header, extType } = this.buildHeaderFromCards(cards);
    const firstKey = header.keys()[0];
    if (startOffset === 0 && firstKey !== 'SIMPLE') {
      throw new FitsError('Invalid FITS file: primary HDU missing SIMPLE keyword.');
    } else if (startOffset !== 0 && firstKey !== 'XTENSION') {
      throw new FitsError('Invalid FITS file: extension HDU missing XTENSION keyword.');
    }
    if (startOffset !== 0) {
      header.set('EXTEND', true);
    }
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

  // Helper: read header cards until an END card is encountered.
  private static readHeaderCards(dataView: DataView, startOffset: number): { cards: string[]; offset: number } {
    const cards: string[] = [];
    let offset = startOffset;
    while (true) {
      const { card, newOffset } = this.readCard(dataView, offset);
      const trimmedCard = card.trim();
      if (trimmedCard.startsWith('END')) {
        break;
      }
      const key = card.substring(0, 8).trim();
      const valuePart = card.substring(8).trim();
      if ((key === 'COMMENT' || key === 'HISTORY') && valuePart === '') {
        // Skip blank COMMENT/HISTORY cards.
      } else {
        cards.push(card);
      }
      offset = newOffset;
    }
    return { cards, offset };
  }

  // Helper: build a header from an array of 80-character cards.
  private static buildHeaderFromCards(cards: string[]): { header: FitsHeader; extType?: string } {
    const header = new FitsHeader();
    let extType: string | undefined = undefined;
    for (const card of cards) {
      const { key, valueStr, comment } = this.parseCard(card);
      if (!key) continue;
      if (key === 'COMMENT') {
        header.addComment(comment ?? '');
        continue;
      }
      if (key === 'HISTORY') {
        header.addHistory(comment ?? '');
        continue;
      }
      const value = this.parseValue(valueStr);
      header.set(key, value, comment);
      if (key === 'XTENSION') {
        extType = typeof value === 'string' ? value.replace(/'/g, '') : `${value}`;
      }
    }
    return { header, extType };
  }

  // Helper: parse a card's value string.
  private static parseValue(valueStr: string): any {
    if (valueStr === '') return undefined;
    if (valueStr.startsWith(`'`)) {
      const endQuoteIndex = valueStr.lastIndexOf(`'`);
      let strVal = endQuoteIndex > 0 ? valueStr.substring(1, endQuoteIndex) : valueStr.substring(1);
      return strVal.replace(/''/g, `'`);
    }
    if (valueStr === 'T' || valueStr === 'F') {
      return valueStr === 'T';
    }
    const numStr = valueStr.replace('D', 'E');
    return /[.Ee]/.test(numStr) ? parseFloat(numStr) : parseInt(numStr, 10);
  }

  // Helper: parse a header card into key, value string, and optional comment.
  private static parseCard(card: string): { key: string; valueStr: string; comment?: string } {
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
}
