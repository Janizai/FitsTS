import { FitsHeader } from './fitsHeader';
import { reshapeArray } from './utils';

export class FitsHDU {
  header: FitsHeader;
  data?: Uint8Array | Int16Array | Int32Array | Float32Array | Float64Array | any[];
  isPrimary: boolean;
  extType?: string;

  constructor(isPrimary: boolean = false) {
    this.isPrimary = isPrimary;
    this.header = new FitsHeader();
  }

  getShape(): number[] {
    if (this.extType == 'BINTABLE' || this.extType == 'TABLE') {
      const nRows = this.header.get('NAXIS2');
      const nCols = this.header.get('TFIELDS');
      if (nRows === undefined || nCols === undefined) return [];
      return [nCols, nRows];
    }
    const naxis: number = this.header.get('NAXIS') ?? 0;
    const dims: number[] = [];
    for (let i = 1; i <= naxis; i++) {
      const axisLength = this.header.get(`NAXIS${i}`);
      if (axisLength !== undefined) dims.push(axisLength);
    }
    return dims;
  }

  public getData(): number[] | number[][] | any[] | undefined {
    if (this.data === undefined) return undefined;
    if (this.extType === 'BINTABLE' || this.extType === 'TABLE') {
      return Array.from(this.data);
    }

    const shape = this.getShape();
    if (shape.length === 0) return undefined;

    if (shape.length === 1) {
      return Array.from(this.data);
    }

    else if (shape.length === 2) {
      // Convention: header stores NAXIS1 as the number of columns and NAXIS2 as the number of rows.
      const nCols = shape[0];
      const nRows = shape[1];
      const flat = Array.from(this.data);
      return reshapeArray(flat, [nRows, nCols]);
    }
    // For ND (N > 2), return the flat array.
    else {
      return Array.from(this.data);
    }
  }


  get width(): number | undefined {
    return this.header.get('NAXIS1');
  }

  get height(): number | undefined {
    return this.header.get('NAXIS2');
  }
}
