const { ObjectId } = require('mongodb');
const service = require('../../../src/services/item-stock-preference');
const branch = new ObjectId(), license = new ObjectId();
function request(type = 'super_admin') {
 const branches = { findOne: jest.fn().mockResolvedValue({ _id: branch, license }), updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }) };
 return { user: { usertype: type }, tenantContext: { branchId: String(branch), licenseId: String(license) }, body: {}, db: { collection: jest.fn(() => branches) }, branches };
}
test('unset preference is not silently converted into a saved choice', async () => {
 const req = request(); expect(await service.read(req)).toEqual({ preference: null });
 expect(req.branches.updateOne).not.toHaveBeenCalled();
});
test.each(['always_available', 'track_quantities'])('owner saves %s only to the current branch', async preference => {
 const req = request(); req.body.preference = preference;
 expect(await service.save(req)).toEqual({ preference });
 const [filter, update] = req.branches.updateOne.mock.calls[0];
 expect(String(filter._id)).toBe(String(branch)); expect(String(filter.license)).toBe(String(license));
 expect(update.$set.item_stock_default).toBe(preference);
 expect(req.db.collection.mock.calls.every(([name]) => name === 'branches')).toBe(true);
});
test('staff and invalid preferences cannot change the shop policy', async () => {
 const req = request('staff'); req.body.preference = 'always_available';
 await expect(service.save(req)).rejects.toMatchObject({ status: 403 });
 const owner = request(); owner.body.preference = 'anything';
 await expect(service.save(owner)).rejects.toMatchObject({ status: 422 });
 expect(req.branches.updateOne).not.toHaveBeenCalled(); expect(owner.branches.updateOne).not.toHaveBeenCalled();
});
