import { FitsHeader } from './fitsHeader';

export class FitsHDU {
  header: FitsHeader;
  data?: Uint8Array | Int16Array | Int32Array | BigInt64Array | Float32Array | Float64Array;
  isPrimary: boolean;
  extType?: string;

  constructor(isPrimary: boolean = false) {
    this.isPrimary = isPrimary;
    this.header = new FitsHeader();
  }

  getShape(): number[] {
    const naxis: number = this.header.get('NAXIS') ?? 0;
    const dims: number[] = [];
    for (let i = 1; i <= naxis; i++) {
      const axisLength = this.header.get(`NAXIS${i}`);
      if (axisLength !== undefined) dims.push(axisLength);
    }
    return dims;
  }

  get width(): number | undefined {
    return this.header.get('NAXIS1');
  }

  get height(): number | undefined {
    return this.header.get('NAXIS2');
  }
}
