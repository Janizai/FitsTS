export class FitsError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'FitsError';
    }
  }
  