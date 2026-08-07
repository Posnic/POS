'use strict';

const mockCreateTransport = jest.fn();
const mockRenderFile = jest.fn();
const mockConvert = jest.fn();
const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: mockCreateTransport,
}));

jest.mock('pug', () => ({
  renderFile: mockRenderFile,
}));

jest.mock('html-to-text', () => ({
  convert: mockConvert,
}));

const { Email, sendEmail } = require('../../../src/utils/email');

describe('email utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EMAIL_FROM = 'no-reply@example.com';
    process.env.NODE_ENV = 'development';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    console.warn.mockRestore();
    console.info.mockRestore();
  });

  test('Email constructor derives names and from address', () => {
    const email = new Email(
      { email: 'user@example.com', firstname: 'Jane', lastname: 'Doe' },
      'http://x'
    );

    expect(email.to).toBe('user@example.com');
    expect(email.firstName).toBe('Jane');
    expect(email.from).toBe('Your App <no-reply@example.com>');
  });

  test('send uses html template and text conversion', async () => {
    mockRenderFile.mockReturnValue('<h1>Hello</h1>');
    mockConvert.mockReturnValue('Hello');
    mockSendMail.mockResolvedValue({ message: 'ok' });
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail, options: {} });

    const email = new Email({ email: 'user@example.com', name: 'User' }, 'http://x');
    await email.send('welcome', 'Welcome');

    expect(mockRenderFile).toHaveBeenCalled();
    expect(mockConvert).toHaveBeenCalledWith('<h1>Hello</h1>');
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Welcome',
        text: 'Hello',
      })
    );
  });

  test('sendEmail uses fallback transport path', async () => {
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail, options: {} });
    mockSendMail.mockResolvedValue({ message: 'ok' });

    await sendEmail({ email: 'user@example.com', subject: 'Hi', message: 'Body' });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Hi',
        text: 'Body',
      })
    );
  });
});
