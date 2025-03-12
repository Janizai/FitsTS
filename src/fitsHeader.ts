import { FitsError } from './errors';

export class FitsHeader {
  private cardList: { key: string; value?: any; comment?: string }[] = [];
  private readonly cards: Map<string, { value: any; comment?: string }> = new Map();

  get(key: string): any {
    return this.cards.get(key)?.value;
  }

  set(key: string, value: any, comment?: string): void {
    if (key === 'COMMENT' || key === 'HISTORY') {
      throw new FitsError(`Use addComment/addHistory to add ${key} cards.`);
    }

    if (this.cards.has(key)) {
      const card = this.cards.get(key)!;
      card.value = value;
      
      if (comment !== undefined) card.comment = comment;

    } else {
      this.cards.set(key, { value, comment });
      this.cardList.push({ key, value, comment });

      Object.defineProperty(this, key, {
        get: () => this.cards.get(key)?.value,
        set: (newVal: any) => this.set(key, newVal),
        enumerable: true,
        configurable: true
      });
    }
  }

  addComment(text: string): void {
    this.cardList.push({ key: 'COMMENT', comment: text });
  }

  addHistory(text: string): void {
    this.cardList.push({ key: 'HISTORY', comment: text });
  }

  remove(key: string): void {
    if (!this.cards.has(key)) return;
    this.cards.delete(key);
    this.cardList = this.cardList.filter(card => card.key !== key);
    if ((this as any)[key] !== undefined) {
      delete (this as any)[key];
    }
  }

  keys(): string[] {
    return this.cardList.map(card => card.key);
  }

  toRecords(): string[] {
    const records: string[] = [];
    for (const card of this.cardList) {
      records.push(this.formatCard(card.key, card.value, card.comment));
    }
    if (records.length === 0 || !records[records.length - 1].startsWith('END')) {
      records.push(this.formatCard('END'));
    }
    while (records.length % 36 !== 0) {
      records.push(' '.repeat(80));
    }
    return records;
  }

  private formatCard(key: string, value?: any, comment?: string): string {
    let card = key.padEnd(8, ' ');

    if (key === 'END') {
      return card + ' '.repeat(72);
    }

    if (key === 'COMMENT' || key === 'HISTORY') {
      const text = comment ?? '';
      let content = text.length > 72 ? text.substring(0, 72) : text;
      return (card + ' ' + content).padEnd(80, ' ');
    }

    card += '= ';
    let valueStr = '';

    if (typeof value === 'number') {
      valueStr = Number.isInteger(value)
        ? value.toString().slice(0, 20).padStart(20, ' ')
        : value.toExponential(6).slice(0, 20).padStart(20, ' ');

    } else if (typeof value === 'boolean') {
      valueStr = (value ? 'T' : 'F').padStart(20, ' ');

    } else if (typeof value === 'string') {
      let strVal = value.replace(/'/g, "''");

      if (strVal.length > 68) strVal = strVal.substring(0, 68);

      valueStr = `'${strVal}'`.padEnd(20, ' ');

    } else if (value === undefined || value === null) {
      valueStr = ''.padEnd(20, ' ');
    }

    let commentStr = '';

    if (comment) {
      commentStr = ` / ${comment}`;
    }

    let record = card + valueStr + commentStr;
    return record.length <= 80 ? record.padEnd(80, ' ') : record.substring(0, 80);
  }
}
