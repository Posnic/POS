jest.mock('../../../src/models/base.model', () => class {});
jest.mock('../../../src/services/messaging.service', () => jest.fn());
jest.mock('../../../src/services/ask-posnic-schedule.service', () => ({
  list: jest.fn(),
  save: jest.fn(),
}));
jest.mock('../../../src/services/ask-posnic-runner.service', () => ({
  buildReport: jest.fn(),
  deliver: jest.fn(),
}));
const schedules = require('../../../src/services/ask-posnic-schedule.service');
const controller = require('../../../src/controllers/messaging.controller');
const req = () => ({
  user: { _id: 'owner', license: 'shop', usertype: 'super_admin', branch_id: 'branch' },
  body: {
    channel: 'email',
    destination: 'owner@example.com',
    timezone: 'Asia/Kolkata',
    frequency: 'monthly',
    report: 'sales',
  },
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(controller, 'success').mockImplementation((res, data) => data);
  jest
    .spyOn(controller, 'error')
    .mockImplementation((res, message, status) => ({ message, status }));
});
afterEach(() => jest.restoreAllMocks());
test('new report is off unless explicitly enabled and scope comes from authenticated user', async () => {
  const request = req();
  request.body.source = 'other';
  request.body.license = 'other';
  schedules.save.mockResolvedValue({});
  await controller.saveReportSchedule(request, {});
  expect(schedules.save).toHaveBeenCalledWith(
    { branchId: 'branch', licenseId: 'shop', userId: 'owner', source: 'messaging' },
    expect.objectContaining({ enabled: false })
  );
});
test('cashier cannot create report deliveries', async () => {
  const request = req();
  request.user.usertype = 'cashier';
  expect((await controller.saveReportSchedule(request, {})).status).toBe(403);
  expect(schedules.save).not.toHaveBeenCalled();
});
test('other outlet or non-messaging schedule cannot be edited', async () => {
  const request = req();
  request.body.id = 'some-id';
  schedules.list.mockResolvedValue([{ _id: 'some-id', source: 'ask_posnic' }]);
  expect((await controller.saveReportSchedule(request, {})).status).toBe(404);
  expect(schedules.save).not.toHaveBeenCalled();
});
test('invalid channel and time zone are rejected before writing', async () => {
  const request = req();
  request.body.channel = 'sms';
  expect((await controller.saveReportSchedule(request, {})).status).toBe(400);
  request.body.channel = 'email';
  request.body.timezone = 'not-a-zone';
  expect((await controller.saveReportSchedule(request, {})).status).toBe(400);
  expect(schedules.save).not.toHaveBeenCalled();
});
test('report test checks scope and does not enable or save a schedule', async () => {
  const request = req();
  request.params = { id: 'test' };
  schedules.list.mockResolvedValue([{ _id: 'test', source: 'messaging', enabled: false }]);
  require('../../../src/models/base.model').getDb = jest.fn().mockResolvedValue({});
  const runner = require('../../../src/services/ask-posnic-runner.service');
  runner.buildReport.mockResolvedValue({ answer: 'Sales summary' });
  runner.deliver.mockResolvedValue({ status: 'sent' });
  await controller.testReport(request, {});
  expect(runner.deliver).toHaveBeenCalledWith(
    expect.objectContaining({ test: true, enabled: false }),
    expect.objectContaining({ answer: expect.stringContaining('POSNIC TEST') })
  );
  expect(schedules.save).not.toHaveBeenCalled();
  schedules.list.mockResolvedValue([]);
  expect((await controller.testReport(request, {})).status).toBe(404);
});
