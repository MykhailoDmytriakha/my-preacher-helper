import { AddressedFailures, eachFailure } from '../failures';

/** BUG-20261003-background-failure-without-address */
describe('failures gathered from many operations', () => {
  it('keep each failure with its own address and leave the original errors untouched', () => {
    const shared = Object.assign(new Error('Disk full'), { code: 'storage-full' });
    const gathered = new AddressedFailures([
      { error: shared, about: { collection: 'sermons', id: 'a' } },
      { error: shared, about: { collection: 'series', id: 'b' } },
    ]);
    expect(eachFailure(gathered).map(entry => entry.about)).toEqual([{ collection: 'sermons', id: 'a' }, { collection: 'series', id: 'b' }]);
    expect(Object.keys(shared)).toEqual(['code']);
    expect(new AddressedFailures([{ error: shared }]).failures[0].about).toBeUndefined();
  });

  it('speak with the first failure\'s words and code', () => {
    const gathered = new AddressedFailures([{ error: Object.assign(new Error('Queue unreadable'), { code: 'storage-silent' }) }]);
    expect(gathered.message).toBe('Queue unreadable');
    expect(gathered.code).toBe('storage-silent');
    expect(gathered).toBeInstanceOf(Error);
  });

  it('treat a single error as one failure with the address given, or none', () => {
    const error = new Error('anything');
    expect(eachFailure(error, { collection: 'sermons' })).toEqual([{ error, about: { collection: 'sermons' } }]);
    expect(eachFailure(error)).toEqual([{ error }]);
  });
});
