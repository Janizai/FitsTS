import { expect } from 'chai';
import { FitsHeader } from '../src/fitsHeader';
import { FitsError } from '../src/errors';

describe('FitsHeader', () => {
  let header: FitsHeader;

  beforeEach(() => {
    header = new FitsHeader();
  });

  describe('Setting and Getting Keywords', () => {
    it('should set and retrieve a keyword correctly', () => {
      header.set('OBJECT', 'Test Object', 'object name');
      // Using get() method
      expect(header.get('OBJECT')).to.equal('Test Object');
      // Dynamic property access should return the same value
      expect((header as any).OBJECT).to.equal('Test Object');
    });

    it('should update an existing keyword with a new value and comment', () => {
      header.set('OBJECT', 'First', 'initial comment');
      header.set('OBJECT', 'Second', 'updated comment');
      expect(header.get('OBJECT')).to.equal('Second');
      expect((header as any).OBJECT).to.equal('Second');
    });
  
    describe('Special Cards Handling', () => {
      it('should not return an END card when calling get()', () => {
        header.set('OBJECT', 'Test Object');
        header.toRecords();
        expect(header.get('END')).to.be.undefined;
      });
    });
  });

  describe('Handling COMMENT and HISTORY Cards', () => {
    it('should throw an error when attempting to set a COMMENT card using set()', () => {
      expect(() => header.set('COMMENT', 'Some comment')).to.throw(
        FitsError,
        /Use addComment\/addHistory/
      );
    });

    it('should throw an error when attempting to set a HISTORY card using set()', () => {
      expect(() => header.set('HISTORY', 'Some history')).to.throw(
        FitsError,
        /Use addComment\/addHistory/
      );
    });

    it('should add a COMMENT card using addComment()', () => {
      header.addComment('This is a comment');
      const keys = header.keys();
      expect(keys).to.include('COMMENT');
    });

    it('should add a HISTORY card using addHistory()', () => {
      header.addHistory('History entry');
      const keys = header.keys();
      expect(keys).to.include('HISTORY');
    });
  });

  describe('Removing Keywords', () => {
    it('should remove an existing keyword', () => {
      header.set('OBJECT', 'Test Object');
      expect(header.get('OBJECT')).to.equal('Test Object');
      header.remove('OBJECT');
      expect(header.get('OBJECT')).to.be.undefined;
      expect(header.keys()).to.not.include('OBJECT');
    });

    it('should not throw an error when removing a non-existent keyword', () => {
      expect(() => header.remove('NONEXISTENT')).to.not.throw();
    });

    it('should remove the dynamic property when a keyword is removed', () => {
      header.set('OBJECT', 'Test Object');
      expect((header as any).OBJECT).to.equal('Test Object');
      header.remove('OBJECT');
      expect((header as any).OBJECT).to.be.undefined;
    });
  });

  describe('keys() Method', () => {
    it('should return the keys in the order they were added', () => {
      header.set('OBJECT', 'Test Object');
      header.set('DATE', '2025-03-12');
      header.addComment('A sample comment');
      const keys = header.keys();
      expect(keys).to.deep.equal(['OBJECT', 'DATE', 'COMMENT']);
    });
  });

  describe('toRecords() Method', () => {
    it('should return an array of strings each exactly 80 characters long', () => {
      header.set('OBJECT', 'Test Object', 'object name');
      const records = header.toRecords();
      records.forEach(record => {
        expect(record.length).to.equal(80);
      });
    });

    it('should include an END card in the non-blank records', () => {
      header.set('OBJECT', 'Test Object');
      const records = header.toRecords();
      // Filter out blank records (which are padding)
      const nonBlankRecords = records.filter(r => r.trim() !== '');
      expect(nonBlankRecords[nonBlankRecords.length - 1].trim().startsWith('END')).to.be.true;
    });

    it('should pad the header so that the total number of records is a multiple of 36', () => {
      header.set('OBJECT', 'Test Object');
      const records = header.toRecords();
      expect(records.length % 36).to.equal(0);
    });
  });

  describe('Card Formatting', () => {
    it('should format numeric values correctly', () => {
      header.set('VALUE', 12345, 'a number');
      const records = header.toRecords();
      const record = records.find(r => r.trim().startsWith('VALUE'));
      expect(record).to.exist;
      // Check that the record includes "= " and the number appears somewhere in the formatted value field.
      expect(record).to.contain('= ');
      expect(record).to.contain('12345');
    });

    it('should format boolean values correctly', () => {
      header.set('FLAG', true, 'a boolean');
      const records = header.toRecords();
      const record = records.find(r => r.trim().startsWith('FLAG'));
      expect(record).to.exist;
      expect(record).to.contain('T');
    });

    it('should format string values correctly and escape single quotes', () => {
      header.set('TITLE', "O'Reilly", 'book publisher');
      const records = header.toRecords();
      const record = records.find(r => r.trim().startsWith('TITLE'));
      expect(record).to.exist;
      expect(record).to.contain("'O''Reilly'");
    });

    it('should format undefined or null values as an empty field', () => {
      header.set('EMPTY', undefined);
      const records = header.toRecords();
      const record = records.find(r => r.trim().startsWith('EMPTY'));
      expect(record).to.exist;
      // Extract the value field (characters 10 to 30)
      if (record) {
        const valueField = record.substring(10, 30);
        expect(valueField.trim()).to.equal('');
      }
    });
  });
});
